/**
 * @file This is the main entry point for the Electron application.
 * It manages the application lifecycle, window creation, and initialization of background services (Database, Local Server, Auth).
 */

import dotenv from 'dotenv';
dotenv.config();

import { app, BrowserWindow } from 'electron';
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
import {
  startLocalServer,
  stopLocalServer,
  getServerPort,
} from './local-server';
import { stopAuthServer } from './auth-server';
import {
  cleanupDriveCacheManager,
  initializeDriveCacheManager,
} from './drive-cache-manager';

import { registerAuthHandlers } from './ipc/auth-controller';
import { registerSystemHandlers } from './ipc/system-controller';
import { registerMediaHandlers } from './ipc/media-controller';
import { registerDatabaseHandlers } from './ipc/database-controller';

import { MediaService } from '../core/media/media-service';
import { MediaRepository } from '../core/database/repositories/media-repository';
import { NodeFileSystem } from '../infrastructure/node-file-system';
import { WorkerScannerService } from '../infrastructure/worker-scanner-service';
import { MediaDurationHandler } from '../infrastructure/media-duration-handler';

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

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

// Register IPC Handlers
registerAuthHandlers();
registerSystemHandlers();
registerMediaHandlers(mediaService);
registerDatabaseHandlers();

function createWindow() {
  const preloadPath = path.join(__dirname, '../preload/preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    const devServerURL =
      process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    mainWindow
      .loadURL(devServerURL)
      .catch((err) =>
        log.error('[main.js] Failed to load development server:', err),
      );
  } else {
    mainWindow
      .loadFile(path.join(__dirname, '../renderer/index.html'))
      .catch((err) => log.error('[main.js] Failed to load index.html:', err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Enable experimental HEVC support (Windows/Mac)
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch(
  'platform-media-player-enable-hevc-support-for-win10',
);

app.on('ready', () => {
  createWindow();

  // Ensure encryption key is stored in persistent user data directory
  if (!process.env.MASTER_KEY_DIR) {
    process.env.MASTER_KEY_DIR = app.getPath('userData');
  }

  const driveCacheDir = path.join(app.getPath('userData'), 'drive-cache');
  const driveCacheManager = initializeDriveCacheManager(driveCacheDir);
  driveCacheManager.on('progress', (data) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('drive:cache-progress', data);
    }
  });

  const securityConfigPath = path.join(
    app.getPath('userData'),
    'security-config.json',
  );
  loadSecurityConfig(securityConfigPath).catch((err) => {
    log.error('[main.js] Failed to load security config:', err);
  });

  // [SECURITY] Protect database file
  registerSensitiveFile('media_slideshow_stats.sqlite');
  registerSensitiveFile('media_slideshow_stats.sqlite-wal');
  registerSensitiveFile('media_slideshow_stats.sqlite-shm');

  initDatabase()
    .then(async () => {
      const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
      await fs.mkdir(cacheDir, { recursive: true });

      startLocalServer(cacheDir, mediaService, () => {
        log.info('[main.js] Local server started in background.');
      });
    })
    .catch((error) => {
      log.error(
        '[main.js] Database initialization failed during app ready sequence:',
        error,
      );
    });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (getServerPort() > 0) {
      createWindow();
    } else {
      const cacheDir = path.join(app.getPath('userData'), 'thumbnails');
      startLocalServer(cacheDir, mediaService, createWindow);
    }
  }
});

app.on('will-quit', () => {
  stopLocalServer(() => {
    log.info('[main.js] Local server stopped during will-quit.');
  });
  stopAuthServer();
  closeDatabase();
  cleanupDriveCacheManager();
});
