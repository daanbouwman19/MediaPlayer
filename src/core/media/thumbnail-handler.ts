import fs from 'fs';
import { Response } from 'express';
import PQueue from 'p-queue';
import { getThumbnailCachePath, isDrivePath } from './media-utils.ts';
import {
  getThumbnailArgs,
  runFFmpeg,
} from '../../infrastructure/ffmpeg-utils.ts';
import { getProvider } from '../../infrastructure/fs-provider-factory.ts';
import {
  validateFileAccess,
  handleAccessCheck,
} from '../auth/access-validator.ts';

const thumbnailQueue = new PQueue({ concurrency: 2 });

async function runFFmpegThumbnail(
  filePath: string,
  cacheFile: string,
  ffmpegPath: string,
): Promise<void> {
  const generateArgs = getThumbnailArgs(filePath, cacheFile);
  const { code, stderr } = await runFFmpeg(ffmpegPath, generateArgs);
  if (code !== 0) {
    throw new Error(`FFmpeg failed with code ${code}: ${stderr}`);
  }
}

/**
 * Helper: Tries to serve a thumbnail from the local cache.
 * Returns true if served, false otherwise.
 */
export async function tryServeFromCache(
  res: Response,
  cacheFile: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    // Bolt Optimization: Use res.sendFile instead of fs.access + fs.createReadStream.
    // This saves a syscall and leverages kernel sendfile optimization.
    // If file doesn't exist, we get an error in callback and return false.
    res.sendFile(
      cacheFile,
      {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
        },
      },
      (err: unknown) => {
        if (err) {
          // If headers already sent, we can't do anything but log
          if (res.headersSent) {
            console.error(
              `[Thumbnail] Error sending cached file ${cacheFile}:`,
              err,
            );
            resolve(true); // Treat as handled to stop further processing
          } else {
            // File not found or other error -> Fallback to generation
            resolve(false);
          }
        } else {
          resolve(true);
        }
      },
    );
  });
}

/**
 * Helper: Tries to fetch and serve a thumbnail from the provider (e.g. Google Drive).
 * Returns true if served, false otherwise.
 */
export async function tryServeFromProvider(
  res: Response,
  filePath: string,
  cacheFile: string,
): Promise<boolean> {
  try {
    const provider = getProvider(filePath);
    const stream = await provider.getThumbnailStream(filePath);
    if (stream) {
      const writeStream = fs.createWriteStream(cacheFile);
      stream.pipe(writeStream);
      stream.pipe(res);
      return true;
    }
  } catch (e) {
    console.warn('[Thumbnail] Provider fetch failed:', e);
  }
  return false;
}

/**
 * Helper: Generates a thumbnail using local FFmpeg and serves it.
 */
export async function generateLocalThumbnail(
  res: Response,
  filePath: string,
  cacheFile: string,
  ffmpegPath: string | null,
): Promise<void> {
  // Use validateFileAccess to enforce security and get realPath
  const access = await validateFileAccess(filePath);
  if (handleAccessCheck(res, access)) return;
  const authorizedPath = access.success ? access.path : '';

  if (!ffmpegPath) {
    res.status(500).send('FFmpeg binary not found');
    return;
  }

  try {
    await thumbnailQueue.add(() =>
      runFFmpegThumbnail(authorizedPath, cacheFile, ffmpegPath),
    );

    // Bolt Optimization: Use res.sendFile instead of fs.stat + fs.createReadStream
    res.sendFile(
      cacheFile,
      {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
        },
      },
      (err: unknown) => {
        if (err) {
          console.error('[Thumbnail] Error sending generated file:', err);
          if (!res.headersSent) res.status(500).end();
        }
      },
    );
  } catch (err) {
    console.error('[Thumbnail] Generation failed:', err);
    if (!res.headersSent) {
      res.status(500).send('Generation failed');
    }
  }
}

/**
 * Handles thumbnail generation.
 */
export async function serveThumbnail(
  _req: unknown, // Request is unused but kept for interface consistency
  res: Response,
  filePath: string,
  ffmpegPath: string | null,
  cacheDir: string,
) {
  // [SECURITY] Validate access before checking cache to prevent IDOR on cached thumbnails
  const access = await validateFileAccess(filePath);
  if (handleAccessCheck(res, access)) return;
  const authorizedPath = access.success ? access.path : '';

  // 1. Check Cache
  const cacheFile = getThumbnailCachePath(authorizedPath, cacheDir);
  if (await tryServeFromCache(res, cacheFile)) {
    return;
  }

  // 2. Try Provider (Drive)
  if (await tryServeFromProvider(res, authorizedPath, cacheFile)) {
    return;
  }

  // Ensure GDrive files don't fall through to local FS if provider fetch failed
  if (isDrivePath(authorizedPath)) {
    if (!res.headersSent) {
      res.status(404).end();
    }
    return;
  }

  // 3. Fallback to FFmpeg (Local)
  await generateLocalThumbnail(res, authorizedPath, cacheFile, ffmpegPath);
}
