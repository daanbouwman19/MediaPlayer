/**
 * @file Media routes.
 */
import { Router } from 'express';
import { AppError } from '../../core/media/errors.ts';
import {
  getAllMetadataAndStats,
  getMediaViewCounts,
  getMetadata,
  getRecentlyPlayed,
  recordMediaView,
  setRating,
  updatePlaybackPosition,
  upsertMetadata,
  listTranscodeJobs,
  deleteTranscodeJob,
} from '../../core/database/database.ts';
import { TranscodeQueueManager } from '../../core/media/transcode-queue-manager.ts';
import {
  authorizeFilePath,
  filterAuthorizedPaths,
} from '../../core/auth/security.ts';
import { getQueryParam } from '../../core/network/http-utils.ts';
import {
  MAX_API_BATCH_SIZE,
  MAX_CONCURRENT_TRANSCODES,
} from '../../core/media/constants.ts';
import {
  MediaHandler,
  serveRawStream,
  serveTranscodedStream,
  validateFileAccess,
} from '../../core/media/media-handler.ts';
import { createMediaSource } from '../../core/media/media-source.ts';
import type { RateLimiters } from '../middleware/rate-limiters.ts';
import { asyncHandler } from '../middleware/async-handler.ts';

import type { Request, Response, NextFunction } from 'express';

export interface MediaRoutesOptions {
  limiters: RateLimiters;
  mediaHandler: MediaHandler;
  transcodeState: { current: number };
  ffmpegPath: string | null;
}

const requireFileQueryParam = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const file = getQueryParam(req.query, 'file');
  if (!file || typeof file !== 'string') {
    return next(new AppError(400, 'Missing file'));
  }
  res.locals.filePath = file;
  next();
};

export function createMediaRoutes({
  limiters,
  mediaHandler,
  transcodeState,
  ffmpegPath,
}: MediaRoutesOptions) {
  const router = Router();
  const { writeLimiter, readLimiter, fileLimiter, streamLimiter } = limiters;

  router.post(
    '/api/media/view',
    writeLimiter,
    asyncHandler(async (req, res) => {
      const { filePath } = req.body;
      if (!filePath || typeof filePath !== 'string') {
        throw new AppError(400, 'Missing or invalid filePath');
      }

      const auth = await authorizeFilePath(filePath);
      if (!auth.isAllowed) {
        return res.status(403).send(auth.message || 'Access denied');
      }

      await recordMediaView(filePath);
      res.sendStatus(200);
    }),
  );

  router.post(
    '/api/media/views',
    readLimiter,
    asyncHandler(async (req, res) => {
      const { filePaths } = req.body;
      if (
        !Array.isArray(filePaths) ||
        !filePaths.every((p) => typeof p === 'string')
      ) {
        return res.status(400).send('Invalid filePaths');
      }

      if (filePaths.length > MAX_API_BATCH_SIZE) {
        return res
          .status(400)
          .send(`Batch size exceeds limit of ${MAX_API_BATCH_SIZE}`);
      }

      const allowedPaths = await filterAuthorizedPaths(filePaths);

      const counts = await getMediaViewCounts(allowedPaths);
      res.json(counts);
    }),
  );

  router.post(
    '/api/media/rate',
    writeLimiter,
    asyncHandler(async (req, res) => {
      const { filePath, rating } = req.body;
      if (
        !filePath ||
        typeof filePath !== 'string' ||
        typeof rating !== 'number'
      ) {
        throw new AppError(400, 'Missing filePath or rating');
      }

      const auth = await authorizeFilePath(filePath);
      if (!auth.isAllowed) {
        return res.status(403).send(auth.message || 'Access denied');
      }

      await setRating(filePath, rating);
      res.sendStatus(200);
    }),
  );

  router.post(
    '/api/media/playback-position',
    writeLimiter,
    asyncHandler(async (req, res) => {
      const { filePath, position } = req.body;
      if (
        !filePath ||
        typeof filePath !== 'string' ||
        typeof position !== 'number' ||
        !Number.isFinite(position)
      ) {
        throw new AppError(400, 'Missing filePath or position');
      }

      const auth = await authorizeFilePath(filePath);
      if (!auth.isAllowed) {
        return res.status(403).send(auth.message || 'Access denied');
      }

      await updatePlaybackPosition(filePath, Math.max(0, position));
      res.sendStatus(200);
    }),
  );

  router.get(
    '/api/media/all',
    readLimiter,
    asyncHandler(async (_req, res) => {
      const items = await getAllMetadataAndStats();
      res.json(items);
    }),
  );

  router.get(
    '/api/media/history',
    readLimiter,
    asyncHandler(async (req, res) => {
      const rawLimit = parseInt(
        getQueryParam(req.query, 'limit') as string,
        10,
      );
      const limit =
        !isNaN(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 1000) : 50;
      const items = await getRecentlyPlayed(limit);
      res.json(items);
    }),
  );

  router.post(
    '/api/media/metadata',
    writeLimiter,
    asyncHandler(async (req, res) => {
      const { filePath, metadata } = req.body;
      if (!filePath || typeof filePath !== 'string' || !metadata) {
        return res.status(400).send('Missing or invalid arguments');
      }

      const auth = await authorizeFilePath(filePath);
      if (!auth.isAllowed) {
        return res.status(403).send(auth.message || 'Access denied');
      }

      await upsertMetadata(filePath, metadata);
      res.sendStatus(200);
    }),
  );

  router.post(
    '/api/media/metadata/batch',
    readLimiter,
    asyncHandler(async (req, res) => {
      const { filePaths } = req.body;
      if (
        !Array.isArray(filePaths) ||
        !filePaths.every((p) => typeof p === 'string')
      ) {
        return res.status(400).send('Invalid filePaths');
      }

      if (filePaths.length > MAX_API_BATCH_SIZE) {
        return res
          .status(400)
          .send(`Batch size exceeds limit of ${MAX_API_BATCH_SIZE}`);
      }

      const allowedPaths = await filterAuthorizedPaths(filePaths);

      const result = await getMetadata(allowedPaths);
      res.json(result);
    }),
  );

  router.get(
    '/api/metadata',
    readLimiter,
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveMetadata(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/stream',
    streamLimiter,
    fileLimiter,
    asyncHandler(async (req, res) => {
      const filePath = getQueryParam(req.query, 'file');
      const startTime = getQueryParam(req.query, 'startTime');
      const isTranscode = getQueryParam(req.query, 'transcode') === 'true';

      if (!filePath) {
        return res.status(400).send('Missing file');
      }

      const access = await validateFileAccess(filePath);
      if (!access.success) {
        if (!res.headersSent) {
          res.status(access.statusCode).send(access.error);
        }
        return;
      }
      const authorizedPath = access.path;

      const source = createMediaSource(authorizedPath);

      if (isTranscode) {
        if (transcodeState.current >= MAX_CONCURRENT_TRANSCODES) {
          throw new AppError(503, 'Server too busy. Please try again later.');
        }

        if (!ffmpegPath) {
          return res.status(500).send('FFmpeg not found');
        }

        transcodeState.current += 1;
        const cleanup = () => {
          transcodeState.current -= 1;
          res.removeListener('finish', cleanup);
          res.removeListener('close', cleanup);
        };

        res.on('finish', cleanup);
        res.on('close', cleanup);

        try {
          await serveTranscodedStream(
            req,
            res,
            source,
            ffmpegPath,
            startTime || undefined,
          );
        } catch (error) {
          cleanup();
          throw error;
        }
        return;
      }

      await serveRawStream(req, res, source);
    }),
  );

  router.get(
    '/api/thumbnail',
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveThumbnail(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/video/heatmap',
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveHeatmap(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/video/heatmap/status',
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveHeatmapProgress(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/hls/master.m3u8',
    streamLimiter,
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveHlsMaster(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/hls/playlist.m3u8',
    streamLimiter,
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveHlsPlaylist(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/hls/status',
    streamLimiter,
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      await mediaHandler.serveHlsStatus(req, res, res.locals.filePath);
    }),
  );

  router.get(
    '/api/hls/:segment',
    streamLimiter,
    fileLimiter,
    requireFileQueryParam,
    asyncHandler(async (req, res) => {
      const segmentParam = req.params.segment;
      const segment = Array.isArray(segmentParam)
        ? segmentParam[0]
        : segmentParam;
      await mediaHandler.serveHlsSegment(
        req,
        res,
        res.locals.filePath,
        segment,
      );
    }),
  );

  router.get(
    '/api/serve',
    streamLimiter,
    fileLimiter,
    asyncHandler(async (req, res) => {
      const filePath = getQueryParam(req.query, 'path');
      if (!filePath || typeof filePath !== 'string') {
        throw new AppError(400, 'Missing path');
      }
      try {
        const access = await validateFileAccess(filePath);
        if (!access.success) {
          if (!res.headersSent) {
            res.status(access.statusCode).send(access.error);
          }
          return;
        }
        const authorizedPath = access.path;

        const source = createMediaSource(authorizedPath);
        await serveRawStream(req, res, source);
      } catch (e: unknown) {
        const msg = (e as Error).message || '';
        if (!res.headersSent) {
          if (msg.includes('Access denied')) {
            res.status(403).send('Access denied');
          } else {
            res.status(500).send('Serve error');
          }
        }
      }
    }),
  );

  router.post(
    '/api/transcode/jobs',
    asyncHandler(async (req, res) => {
      const { paths } = req.body as { paths?: unknown };
      if (!Array.isArray(paths) || paths.length === 0) {
        throw new AppError(400, 'paths must be a non-empty array');
      }
      const manager = TranscodeQueueManager.getInstance();
      for (const p of paths) {
        if (typeof p !== 'string') throw new AppError(400, 'Invalid path');
        const auth = await authorizeFilePath(p);
        if (!auth.isAllowed) {
          return res.status(403).send(auth.message || 'Access denied');
        }
        await manager.enqueue(p);
      }
      res.status(204).send();
    }),
  );

  router.get(
    '/api/transcode/jobs',
    asyncHandler(async (_req, res) => {
      const jobs = await listTranscodeJobs();
      res.json(jobs);
    }),
  );

  router.delete(
    '/api/transcode/jobs',
    asyncHandler(async (req, res) => {
      const { path: filePath } = req.body as { path?: unknown };
      if (typeof filePath !== 'string' || !filePath) {
        throw new AppError(400, 'path is required');
      }
      const auth = await authorizeFilePath(filePath);
      if (!auth.isAllowed) {
        return res.status(403).send(auth.message || 'Access denied');
      }
      await TranscodeQueueManager.getInstance().cancel(filePath);
      await deleteTranscodeJob(filePath);
      res.status(204).send();
    }),
  );

  return router;
}
