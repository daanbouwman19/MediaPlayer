/**
 * @file This is the main entry point for the Electron application.
 * It manages the application lifecycle, window creation, and initialization of background services (Database, Local Server, Auth).
 */

import dotenv from 'dotenv';
dotenv.config();

import { app, BrowserWindow, dialog, safeStorage, session } from 'electron';
import log from 'electron-log/main.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

log.initialize();

import { initDatabase } from './database';
import { closeDatabase } from '../core/database/database';
import {
  loadSecurityConfig,
  registerSensitiveFile,
} from '../core/auth/security';
import { setMasterKey } from '../core/auth/encryption';
import {
  startLocalServer,
  stopLocalServer,
  authorizeSessionRequests,
} from './local-server';
import { stopAuthServer } from './auth-server';
import {
  cleanupDriveCacheManager,
  initializeDriveCacheManager,
} from '../infrastructure/drive-cache-manager';
import { loadProtectedMasterKey } from './master-key-store';
import {
  getRendererOrigins,
  resolveRendererSource,
  secureWebContents,
  setTrustedRenderer,
} from './renderer-security';

import { registerAuthHandlers } from './ipc/auth-controller';
import { registerSystemHandlers } from './ipc/system-controller';
import { registerMediaHandlers } from './ipc/media-controller';
import { registerDatabaseHandlers } from './ipc/database-controller';

import { MediaService } from '../core/media/media-service';
import { shutdownTranscoding } from '../core/media/transcode-queue-manager';
import { MediaRepository } from '../core/database/repositories/media-repository';
import { NodeFileSystem } from '../infrastructure/node-file-system';
import { WorkerScannerService } from '../infrastructure/worker-scanner-service';
import { MediaDurationHandler } from '../infrastructure/media-duration-handler';
import { registerDriveBackend } from '../core/media/drive-backend';
import { googleDriveBackend } from '../infrastructure/google-drive-backend';

// Give src/core its Google Drive implementation (see core/media/drive-backend).
registerDriveBackend(googleDriveBackend);

// Initialize Media Service and Dependencies
const mediaRepo = new MediaRepository();
const fileSystem = new NodeFileSystem();
const workerService = new WorkerScannerService();
const mediaHandler = new MediaDurationHandler();
const mediaService = new MediaService(
  mediaRepo,
  fileSystem,
  workerService,
  mediaHandler,
);

// The dev server is used only for `npm run electron:dev`; packaged builds and
// `npm run electron:preview` load the built renderer.
const rendererSource = resolveRendererSource({
  isPackaged: app.isPackaged,
  devServerUrl: process.env.VITE_DEV_SERVER_URL,
  indexHtmlPath: path.join(__dirname, '../renderer/index.html'),
});

let mainWindow: BrowserWindow | null = null;
let isStartupComplete = false;

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // [SECURITY] The renderer displays local media only; it must never open
  // child windows or navigate away from the app shell.
  secureWebContents(mainWindow.webContents, rendererSource);

  if (rendererSource.kind === 'dev-server') {
    mainWindow
      .loadURL(rendererSource.url)
      .catch((err) =>
        log.error('[main.js] Failed to load development server:', err),
      );
  } else {
    mainWindow
      .loadFile(rendererSource.path)
      .catch((err) => log.error('[main.js] Failed to load index.html:', err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function focusMainWindow() {
  if (!mainWindow) {
    if (isStartupComplete) createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * Points the token encryption at the user data directory and, where the OS
 * offers it, at a master key protected by safeStorage.
 */
function configureMasterKey(userDataDir: string) {
  if (!process.env.MASTER_KEY_DIR) {
    process.env.MASTER_KEY_DIR = userDataDir;
  }
  if (process.env.MASTER_KEY) return; // An explicit key always wins.

  try {
    const key = loadProtectedMasterKey(process.env.MASTER_KEY_DIR, safeStorage);
    if (key) setMasterKey(key);
  } catch (error) {
    log.error(
      '[main.js] Could not use the protected master key; falling back to the key file:',
      error,
    );
  }
}

/**
 * Initializes storage and background services, then starts the local media
 * server. Rejects if the app cannot run.
 */
async function initializeServices() {
  const userDataDir = app.getPath('userData');
  configureMasterKey(userDataDir);

  const driveCacheDir = path.join(userDataDir, 'drive-cache');
  const driveCacheManager = initializeDriveCacheManager(driveCacheDir);
  driveCacheManager.on('progress', (data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('drive:cache-progress', data);
    }
  });

  const securityConfigPath = path.join(userDataDir, 'security-config.json');
  await loadSecurityConfig(securityConfigPath).catch((err) => {
    log.error('[main.js] Failed to load security config:', err);
  });

  // [SECURITY] Protect database file
  registerSensitiveFile('media_slideshow_stats.sqlite');
  registerSensitiveFile('media_slideshow_stats.sqlite-wal');
  registerSensitiveFile('media_slideshow_stats.sqlite-shm');

  await initDatabase();
  const cacheDir = path.join(userDataDir, 'thumbnails');
  await fs.mkdir(cacheDir, { recursive: true });

  const port = await startLocalServer(cacheDir, mediaService, {
    allowedOrigins: getRendererOrigins(rendererSource),
  });
  authorizeSessionRequests(session.defaultSession, port);
  log.info(`[main.js] Local server started on port ${port}.`);
}

async function startApp() {
  try {
    await initializeServices();
  } catch (error) {
    log.error('[main.js] Startup failed:', error);
    dialog.showErrorBox(
      'MediaPlayer could not start',
      `The media library could not be opened.\n\n${error instanceof Error ? error.message : String(error)}`,
    );
    app.quit();
    return;
  }

  isStartupComplete = true;
  // The renderer reads the server port once when it loads, so the window is
  // only created once the server is listening.
  createWindow();
}

// Enable experimental HEVC support (Windows/Mac)
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch(
  'platform-media-player-enable-hevc-support-for-win10',
);

// [CONCURRENCY] A second instance would share the database, the HLS output
// and the Drive cache with this one, so it only focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  setTrustedRenderer(rendererSource);

  // Register IPC Handlers
  registerAuthHandlers();
  registerSystemHandlers();
  registerMediaHandlers(mediaService);
  registerDatabaseHandlers();

  app.on('second-instance', () => {
    focusMainWindow();
  });

  app.on('ready', () => {
    void startApp();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && isStartupComplete) {
      createWindow();
    }
  });

  // Stop ffmpeg (non-detached children outlive the app on macOS/Linux) and
  // flush the database before quitting; will-quit cannot wait for either.
  let quitCleanupDone = false;
  app.on('before-quit', (event) => {
    if (quitCleanupDone) return;
    quitCleanupDone = true;
    event.preventDefault();
    void shutdownTranscoding()
      .then(() => closeDatabase())
      .catch((error: unknown) => {
        log.error('[main.js] Cleanup before quit failed:', error);
      })
      .finally(() => app.quit());
  });

  app.on('will-quit', () => {
    stopLocalServer(() => {
      log.info('[main.js] Local server stopped during will-quit.');
    });
    stopAuthServer();
    closeDatabase().catch((error) => {
      log.error('[main.js] Failed to close database during will-quit:', error);
    });
    cleanupDriveCacheManager();
  });
}
