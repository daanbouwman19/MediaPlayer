/**
 * @file Express application setup for the web server.
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import ffmpegStatic from 'ffmpeg-static';
import { initDatabase } from '../core/database.ts';
import {
  HLS_CACHE_DIR_NAME,
  HEATMAP_CACHE_DIR_NAME,
} from '../core/constants.ts';
import { registerSensitiveFile } from '../core/security.ts';
import { initializeDriveCacheManager } from '../main/drive-cache-manager.ts';
import { HlsManager } from '../core/hls-manager.ts';
import { MediaAnalyzer } from '../core/analysis/media-analyzer.ts';
import { MediaHandler } from '../core/media-handler.ts';
import { WorkerFactory } from '../core/worker-factory.ts';
import { createRateLimiters } from './middleware/rate-limiters.ts';
import { basicAuthMiddleware } from './middleware/basic-auth.ts';
import { globalPasswordMiddleware } from './middleware/global-password.ts';
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

registerSensitiveFile(path.basename(DB_PATH));
registerSensitiveFile(path.basename(DB_PATH) + '-wal');
registerSensitiveFile(path.basename(DB_PATH) + '-shm');

const CACHE_ROOT = path.join(process.cwd(), 'cache');
const CACHE_DIR = path.join(CACHE_ROOT, 'thumbnails');
const HLS_CACHE_DIR = path.join(CACHE_ROOT, HLS_CACHE_DIR_NAME);
const DRIVE_CACHE_DIR = path.join(CACHE_ROOT, 'drive');

export async function createApp() {
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
      ? process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
      : false,
  };
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '10mb' }));

  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  const limiters = createRateLimiters();

  // Address Comment 2811709152: Apply authLimiter to Basic Auth to prevent brute-force
  // Use a specific limiter that skips successful requests to avoid blocking legitimate traffic
  app.use(limiters.basicAuthLimiter);
  app.use(basicAuthMiddleware);
  app.use(globalPasswordMiddleware);

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
        workerDir: path.join(__dirname, '../core'),
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

    MediaAnalyzer.getInstance().setCacheDir(HEATMAP_DIR);
  } catch (e) {
    console.error('Failed to initialize database:', e);
    process.exit(1);
  }

  const mediaHandler = new MediaHandler({
    ffmpegPath: ffmpegStatic,
    cacheDir: CACHE_DIR,
  });

  app.use(createAlbumRoutes(limiters));
  app.use(
    createMediaRoutes({
      limiters,
      mediaHandler,
      transcodeState,
      ffmpegPath: ffmpegStatic,
    }),
  );
  app.use(createAuthRoutes(limiters));
  app.use(createSystemRoutes(limiters));

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
      res.sendFile(path.join(clientDistPath, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
