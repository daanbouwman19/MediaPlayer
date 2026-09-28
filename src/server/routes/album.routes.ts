/**
 * @file Album routes.
 */
import { Router } from 'express';
import { AppError } from '../../core/media/errors.ts';
import { MediaService } from '../../core/media/media-service.ts';
import { MAX_API_BATCH_SIZE } from '../../core/media/constants.ts';
import { filterAuthorizedLibraryPaths } from '../../core/media/utils/authorized-paths.ts';
import { getFFmpegStaticPath } from '../../infrastructure/ffmpeg-static-path.ts';
import type { RateLimiters } from '../middleware/rate-limiters.ts';
import { asyncHandler } from '../middleware/async-handler.ts';

/**
 * @param ffmpegPath - The ffmpeg binary used for background metadata
 * extraction after a scan (durations, sizes). Defaults to the bundled
 * ffmpeg-static binary, as in Electron.
 */
export function createAlbumRoutes(
  limiters: RateLimiters,
  mediaService: MediaService,
  ffmpegPath: string | null = getFFmpegStaticPath(),
) {
  const router = Router();

  router.get(
    '/api/albums',
    limiters.readLimiter,
    asyncHandler(async (_req, res) => {
      try {
        const albums = await mediaService.getAlbumsWithViewCounts(
          ffmpegPath ?? undefined,
        );
        res.json(albums);
      } catch {
        throw new AppError(500, 'Failed to fetch albums');
      }
    }),
  );

  router.post(
    '/api/albums/reindex',
    limiters.writeLimiter,
    asyncHandler(async (_req, res) => {
      try {
        const albums = await mediaService.getAlbumsWithViewCountsAfterScan(
          ffmpegPath ?? undefined,
        );
        res.json(albums);
      } catch {
        throw new AppError(500, 'Failed to reindex');
      }
    }),
  );

  // Mirrors the Electron MEDIA_EXTRACT_METADATA IPC handler.
  router.post(
    '/api/media/extract-metadata',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const { filePaths } = req.body as { filePaths?: unknown };
      if (
        !Array.isArray(filePaths) ||
        !filePaths.every((p): p is string => typeof p === 'string')
      ) {
        throw new AppError(400, 'Invalid filePaths');
      }
      if (filePaths.length > MAX_API_BATCH_SIZE) {
        throw new AppError(
          400,
          `Batch size exceeds limit of ${MAX_API_BATCH_SIZE}`,
        );
      }
      if (!ffmpegPath) {
        console.warn('FFmpeg not found, skipping metadata extraction');
        res.sendStatus(202);
        return;
      }

      // [SECURITY] Filter out unauthorized paths to prevent arbitrary file access
      const allowedPaths = await filterAuthorizedLibraryPaths(filePaths);

      // Extraction runs in the background; the client doesn't wait for ffmpeg.
      // Requests join the single extraction job, so they never stack ffmpeg
      // work alongside each other or a scan's extraction.
      mediaService.queueMetadataExtraction(allowedPaths, ffmpegPath, {
        forceCheck: true,
      });
      res.sendStatus(202);
    }),
  );

  return router;
}
