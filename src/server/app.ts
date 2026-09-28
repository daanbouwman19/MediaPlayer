/**
 * @file Express application setup for the web server.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieSession from 'cookie-session';
import helmet from 'helmet';
import lusca from 'lusca';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import { getFFmpegStaticPath } from '../infrastructure/ffmpeg-static-path';
import { MediaService } from '../core/media/media-service.ts';
import { initDatabase } from '../core/database/database.ts';
import {
  HLS_CACHE_DIR_NAME,
  HEATMAP_CACHE_DIR_NAME,
} from '../core/media/constants.ts';
import { registerSensitiveFile } from '../core/auth/security.ts';
import { initializeDriveCacheManager } from '../main/drive-cache-manager.ts';
import { registerDriveBackend } from '../core/media/drive-backend.ts';
import { googleDriveBackend } from '../infrastructure/google-drive-backend.ts';
import { HlsManager } from '../core/media/hls-manager.ts';
import { TranscodeQueueManager } from '../core/media/transcode-queue-manager.ts';
import { MediaAnalyzer } from '../core/media/analysis/media-analyzer.ts';
import { MediaHandler } from '../core/media/media-handler.ts';
import { WorkerFactory } from '../core/database/worker-factory.ts';
import { createRateLimiters } from './middleware/rate-limiters.ts';
import { basicAuthMiddleware } from './middleware/basic-auth.ts';
import {
  createEphemeralSessionSecret,
  globalPasswordMiddleware,
  SESSION_MAX_AGE_MS,
  setSessionFingerprintKey,
} from './middleware/global-password.ts';
import { noCacheMiddleware } from './middleware/no-cache.ts';
import { errorHandler } from './middleware/error-handler.ts';
import { createAlbumRoutes } from './routes/album.routes.ts';
import { createMediaRoutes } from './routes/media.routes.ts';
import { createAuthRoutes } from './routes/auth.routes.ts';
import { createSystemRoutes } from './routes/system.routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH =
  process.env.DB_FILE_PATH || path.join(process.cwd(), 'media-library.db');

// Ensure encryption key is stored alongside the database
if (!process.env.MASTER_KEY_DIR) {
  process.env.MASTER_KEY_DIR = path.dirname(DB_PATH);
}

registerSensitiveFile(path.basename(DB_PATH));
registerSensitiveFile(path.basename(DB_PATH) + '-wal');
registerSensitiveFile(path.basename(DB_PATH) + '-shm');

// Give src/core its Google Drive implementation (see core/media/drive-backend).
registerDriveBackend(googleDriveBackend);

const CACHE_ROOT = path.join(process.cwd(), 'cache');
const CACHE_DIR = path.join(CACHE_ROOT, 'thumbnails');
const HLS_CACHE_DIR = path.join(CACHE_ROOT, HLS_CACHE_DIR_NAME);
const DRIVE_CACHE_DIR = path.join(CACHE_ROOT, 'drive');

export async function createApp(mediaService: MediaService) {
  const isDev = process.env.NODE_ENV !== 'production';
  const app = express();

  app.use((_req, res, next) => {
    res.locals.nonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            (_req, res) => `'nonce-${(res as express.Response).locals.nonce}'`,
            ...(isDev ? ["'unsafe-inline'"] : []),
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            'https://fonts.googleapis.com',
          ],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          mediaSrc: ["'self'", 'blob:'],
          // hls.js runs its transmuxer in a worker created from a blob: URL.
          workerSrc: ["'self'", 'blob:'],
          connectSrc: ["'self'"],
        },
      },
    }),
  );

  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    );
    next();
  });

  const corsOptions = {
    origin: isDev
      ? [
          process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173',
          'https://localhost:5173',
          'https://127.0.0.1:5173',
        ]
      : false,
    credentials: true,
  };
  app.use(cors(corsOptions));

  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  const sessionSecret = process.env.SESSION_SECRET;
  if (!isDev && !sessionSecret) {
    console.error(
      'FATAL: SESSION_SECRET environment variable is required in production.',
    );
    process.exit(1);
  }

  const sessionKey = sessionSecret || createEphemeralSessionSecret();
  setSessionFingerprintKey(sessionKey);

  app.use(
    cookieSession({
      name: 'session',
      keys: [sessionKey],
      maxAge: SESSION_MAX_AGE_MS,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
    }),
  );

  if (process.env.NODE_ENV !== 'test') {
    app.use(lusca.csrf({ angular: true })); // Sets XSRF-TOKEN cookie and expects X-XSRF-TOKEN header
  }

  const limiters = createRateLimiters();

  // Counts only rejected credentials towards its lockout.
  app.use(basicAuthMiddleware);
  app.use(globalPasswordMiddleware);

  // Parsed only after authentication, so locked-out or unauthenticated
  // clients cannot make the server buffer and parse large bodies.
  app.use(express.json({ limit: '1mb' }));

  // Apply no-cache middleware to API routes to prevent sensitive data leakage
  app.use('/api', noCacheMiddleware);

  const transcodeState = { current: 0 };

  try {
    const isElectron = !!process.versions.electron;

    const { path: workerPath, options: workerOptions } =
      await WorkerFactory.getWorkerPath('database-worker', {
        currentDirname: __dirname,
        currentUrl: import.meta.url,
        isElectron,
        workerDir: path.join(__dirname, '../core/database'),
        serverWorkerAlias: 'worker',
      });

    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await initDatabase(DB_PATH, workerPath, workerOptions);
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.mkdir(DRIVE_CACHE_DIR, { recursive: true });
    await fs.mkdir(HLS_CACHE_DIR, { recursive: true });

    // Dedicated Heatmaps Directory
    const HEATMAP_DIR = path.join(CACHE_ROOT, HEATMAP_CACHE_DIR_NAME);
    await fs.mkdir(HEATMAP_DIR, { recursive: true });

    initializeDriveCacheManager(DRIVE_CACHE_DIR);

    HlsManager.getInstance().setCacheDir(HLS_CACHE_DIR);
    TranscodeQueueManager.getInstance()
      .start()
      .catch((err: unknown) => {
        console.error('[TranscodeQueue] Failed to resume pending jobs:', err);
      });

    MediaAnalyzer.getInstance().setCacheDir(HEATMAP_DIR);
  } catch (e) {
    console.error('Failed to initialize database:', e);
    process.exit(1);
  }

  const mediaHandler = new MediaHandler({
    ffmpegPath: getFFmpegStaticPath(),
    cacheDir: CACHE_DIR,
    mediaService,
  });

  app.use(createAlbumRoutes(limiters, mediaService));
  app.use(
    createMediaRoutes({
      limiters,
      mediaHandler,
      transcodeState,
      ffmpegPath: getFFmpegStaticPath(),
    }),
  );
  app.use(createAuthRoutes(limiters));
  app.use(createSystemRoutes(limiters));

  // Unknown API endpoints get a JSON 404 instead of the SPA's index.html.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (!isDev) {
    const clientDistPath = path.join(__dirname, '../client');

    app.use(
      '/assets',
      express.static(path.join(clientDistPath, 'assets'), {
        maxAge: '1y',
        immutable: true,
      }),
    );

    app.use(express.static(clientDistPath));

    app.get(/.*/, limiters.readLimiter, (_req, res) => {
      // With `root`, only the relative path is checked for dotfile segments,
      // so installs below a dot-directory (e.g. ~/.local/...) still work.
      res.sendFile('index.html', { root: clientDistPath });
    });
  }

  app.use(errorHandler);

  return app;
}
