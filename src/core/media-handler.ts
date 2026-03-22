/**
 * @file Shared media request handler.
 * Handles video streaming, metadata retrieval, and thumbnail generation.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import crypto from 'crypto';
import { createMediaSource } from './media-source.ts';

import type { IMediaSource } from './media-source-types.ts';
import { isDrivePath, normalizeFilePath } from './media-utils.ts';
import { getTranscodeArgs, getFFmpegDuration } from './utils/ffmpeg-utils.ts';
import { parseHttpRange, getQueryParam } from './utils/http-utils.ts';
import { FileSystemProvider } from './fs-provider.ts';
import { getProvider } from './fs-provider-factory.ts';
import { authorizeFilePath } from './security.ts';
import { validateFileAccess } from './access-validator.ts';
import { getAuthorizedPath } from './access-utils.ts';
import { serveThumbnail } from './thumbnail-handler.ts';
import { MediaAnalyzer } from './analysis/media-analyzer.ts';
import {
  serveHlsMaster,
  serveHlsPlaylist,
  serveHlsSegment,
} from './hls-handler.ts';
import { HlsManager } from './hls-manager.ts';
import {
  DATA_URL_THRESHOLD_BYTES,
  RATE_LIMIT_FILE_WINDOW_MS,
  RATE_LIMIT_FILE_MAX_REQUESTS,
} from './constants.ts';
import { createRateLimiter } from './rate-limiter.ts';
import { MediaRoutes } from './routes.ts';
import {
  GenerateUrlOptions,
  GenerateUrlResult,
} from './media-handler-types.ts';

export interface MediaHandlerOptions {
  ffmpegPath: string | null;
  cacheDir: string;
}

export class MediaHandler {
  constructor(private config: MediaHandlerOptions) {}

  async handleStreamRequest(req: Request, res: Response) {
    return handleStreamRequest(req, res, this.config.ffmpegPath);
  }

  async serveMetadata(req: Request, res: Response, filePath: string) {
    return serveMetadata(req, res, filePath, this.config.ffmpegPath);
  }

  async serveThumbnail(req: Request, res: Response, filePath: string) {
    return serveThumbnail(
      req,
      res,
      filePath,
      this.config.ffmpegPath,
      this.config.cacheDir,
    );
  }

  async serveHeatmap(req: Request, res: Response, filePath: string) {
    return serveHeatmap(req, res, filePath);
  }

  async serveHeatmapProgress(req: Request, res: Response, filePath: string) {
    return serveHeatmapProgress(req, res, filePath);
  }

  async serveHlsMaster(req: Request, res: Response, filePath: string) {
    return serveHlsMaster(req, res, filePath);
  }

  async serveHlsPlaylist(req: Request, res: Response, filePath: string) {
    return serveHlsPlaylist(req, res, filePath);
  }

  async serveHlsSegment(
    req: Request,
    res: Response,
    filePath: string,
    segmentName: string,
  ) {
    return serveHlsSegment(req, res, filePath, segmentName);
  }

  async serveHlsStatus(req: Request, res: Response, filePath: string) {
    return serveHlsStatus(req, res, filePath);
  }

  async serveStaticFile(req: Request, res: Response, filePath: string) {
    return serveStaticFile(req, res, filePath);
  }
}

// Re-export for compatibility
export { validateFileAccess };

/**
 * Helper: Attempts to serve a local file directly using Express's sendFile.
 * Returns true if the file was sent (or at least attempted without immediate error),
 * false if we should fall back to manual streaming.
 */
function tryServeDirectFile(res: Response, filePath: string): boolean {
  if (isDrivePath(filePath)) return false;

  try {
    const rootDir = path.dirname(filePath);
    const fileName = path.basename(filePath);
    res.sendFile(fileName, { root: rootDir });
    return true;
  } catch (e) {
    console.error('[Handler] SendFile check failed:', e);
    return false;
  }
}

/**
 * Processes the stream by creating a media source and choosing the appropriate streaming method.
 */
async function processStream(
  req: Request,
  res: Response,
  authorizedPath: string,
  options: {
    isTranscodeForced: boolean;
    ffmpegPath: string | null;
    startTime: string | undefined;
  },
) {
  const { isTranscodeForced, ffmpegPath, startTime } = options;
  const source = createMediaSource(authorizedPath);

  if (isTranscodeForced) {
    if (!ffmpegPath) {
      res.status(500).send('FFmpeg binary not found');
      return;
    }
    return serveTranscodedStream(req, res, source, ffmpegPath, startTime);
  }

  return serveRawStream(req, res, source);
}

/**
 * Handles video stream requests (raw or transcoded).
 */
export async function handleStreamRequest(
  req: Request,
  res: Response,
  ffmpegPath: string | null,
) {
  const filePath = getQueryParam(req.query, 'file');
  const startTime = getQueryParam(req.query, 'startTime');
  const isTranscodeForced = req.query.transcode === 'true';

  if (!filePath) {
    return res.status(400).send('Missing file parameter');
  }

  try {
    // 1. Authorization Check
    const authorizedPath = await getAuthorizedPath(res, filePath);
    if (!authorizedPath) return;

    // 2. Direct File Optimization
    if (!isTranscodeForced && tryServeDirectFile(res, authorizedPath)) {
      return;
    }

    // 3. Fallback / Transcoding Logic
    await processStream(req, res, authorizedPath, {
      isTranscodeForced,
      ffmpegPath,
      startTime,
    });
  } catch (e: unknown) {
    console.error('[Handler] Stream failed:', e);
    if (!res.headersSent) {
      const msg = (e as Error).message || '';
      if (msg.includes('Access denied')) {
        res.status(403).send('Access denied.');
      } else {
        res.status(500).send('Error initializing source');
      }
    }
  }
}

/**
 * Retrieves video duration using ffmpeg or provider metadata.
 */
export async function getVideoDuration(
  filePath: string,
  ffmpegPath: string,
): Promise<{ duration: number } | { error: string }> {
  try {
    // Bolt Optimization: Skip provider metadata check for local files
    // as LocalFileSystemProvider does not provide duration and performs redundant fs.stat
    if (isDrivePath(filePath)) {
      const provider = getProvider(filePath);
      const meta = await provider.getMetadata(filePath);
      if (meta.duration) {
        return { duration: meta.duration };
      }
    }
  } catch {
    // Ignore provider errors
  }

  // If it's a Drive file and we didn't get duration from metadata,
  // we can't easily use local FFmpeg on the ID string.
  if (isDrivePath(filePath)) {
    return { error: 'Duration not available' };
  }

  try {
    const duration = await getFFmpegDuration(filePath, ffmpegPath);
    return { duration };
  } catch (error: unknown) {
    return { error: (error as Error).message };
  }
}

/**
 * Handles metadata retrieval.
 */
export async function serveMetadata(
  _req: Request,
  res: Response,
  filePath: string,
  ffmpegPath: string | null,
) {
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  if (!ffmpegPath && !isDrivePath(authorizedPath)) {
    res.status(500).send('FFmpeg binary not found');
    return;
  }

  const result = await getVideoDuration(authorizedPath, ffmpegPath || '');

  res.json(result);
}

/**
 * Serves a raw stream (Direct Play) for a media source.
 */
export async function serveRawStream(
  req: Request,
  res: Response,
  source: IMediaSource,
) {
  const totalSize = await source.getSize();
  const mimeType = await source.getMimeType();
  const rangeHeader = req.headers.range;

  const { start, end, error } = parseHttpRange(totalSize, rangeHeader);

  if (error || start >= totalSize) {
    res
      .status(416)
      .set({ 'Content-Range': `bytes */${totalSize}` })
      .send('Requested range not satisfiable.');
    return;
  }

  const { stream, length } = await source.getStream({ start, end });
  const actualEnd = start + length - 1;

  res.status(206).set({
    'Content-Range': `bytes ${start}-${actualEnd}/${totalSize}`,
    'Accept-Ranges': 'bytes',
    'Content-Length': length.toString(),
    'Content-Type': mimeType,
  });

  stream.pipe(res);

  stream.on('error', (err) => {
    console.error('[RawStream] Stream error:', err);
    if (!res.headersSent) {
      res.status(500).end();
    }
  });

  req.on('close', () => {
    stream.destroy();
  });
}

/**
 * Spawns FFmpeg to transcode the source and pipes output to response.
 */
export async function serveTranscodedStream(
  req: Request,
  res: Response,
  source: IMediaSource,
  ffmpegPath: string,
  startTime: string | undefined,
) {
  const inputPath = await source.getFFmpegInput();

  res.set({
    'Content-Type': 'video/mp4',
  });

  const ffmpegArgs = getTranscodeArgs(inputPath, startTime);
  const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs);

  ffmpegProcess.stdout.pipe(res);

  const stderrReader = createInterface({ input: ffmpegProcess.stderr });
  stderrReader.on('line', (line) => {
    console.error(`[Transcode] FFmpeg Stderr: ${line}`);
  });

  ffmpegProcess.on('error', (err) => {
    console.error('[Transcode] Spawn Error:', err);
  });

  req.on('close', () => {
    ffmpegProcess.kill('SIGKILL');
  });
}

export { serveHlsMaster, serveHlsPlaylist, serveHlsSegment };

/**
 * Serves the progress of HLS transcoding.
 */
export async function serveHlsStatus(
  _req: Request,
  res: Response,
  filePath: string,
) {
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  const sessionId = crypto.createHash('md5').update(authorizedPath).digest('hex');
  const hlsManager = HlsManager.getInstance();
  const progress = hlsManager.getSessionProgress(sessionId);

  res.json({ progress: progress || null });
}

/**
 * Serves the Heatmap data for a media file.
 */
export async function serveHeatmap(
  req: Request,
  res: Response,
  filePath: string,
) {
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  try {
    const pointsStr = getQueryParam(req.query, 'points');
    const points = pointsStr ? parseInt(pointsStr, 10) : 100;

    const analyzer = MediaAnalyzer.getInstance();
    const data = await analyzer.generateHeatmap(authorizedPath, points);
    res.json(data);
  } catch (e) {
    console.error('[Heatmap] Error generating heatmap:', e);
    res.status(500).send('Heatmap generation failed');
  }
}

/**
 * Serves the progress of heatmap generation.
 */
export async function serveHeatmapProgress(
  _req: Request,
  res: Response,
  filePath: string,
) {
  // Authorization check is lightweight here, but good practice
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  const analyzer = MediaAnalyzer.getInstance();
  const progress = analyzer.getProgress(authorizedPath);

  if (progress === null) {
    // If null, job doesn't exist. It might be done or never started.
    // We return 200 with null to avoid console 404 errors during polling.
    res.json({ progress: null });
  } else {
    res.json({ progress });
  }
}

// Re-export serveThumbnail from the new handler for compatibility/convenience
export { serveThumbnail };

/**
 * Handles static file serving.
 */
export async function serveStaticFile(
  req: Request,
  res: Response,
  filePath: string,
) {
  try {
    // getAuthorizedPath performs full access validation and returns a normalized, real path.
    const authorizedPath = await getAuthorizedPath(res, filePath);
    if (!authorizedPath) return;

    // If local file, use res.sendFile for optimizing range/seeking
    if (!isDrivePath(authorizedPath)) {
      // [SECURITY] Explicitly re-validate/sanitize local path to prevent traversal.
      // This is a defense-in-depth check; it must not weaken the guarantees from getAuthorizedPath.
      const auth = await authorizeFilePath(authorizedPath);
      if (!auth.isAllowed || !auth.realPath) {
        // Return 403 explicitly here to match previous behavior and satisfy tests
        // that mock authorizeFilePath failure after validateFileAccess success.
        console.warn(
          '[ServeStatic] Access denied during re-validation:',
          auth.message,
        );
        if (!res.headersSent) res.status(403).send('Access denied.');
        return;
      }

      // Use the fully validated absolute path returned by authorization.
      return res.sendFile(auth.realPath);
    }

    const source = createMediaSource(authorizedPath);
    return await serveRawStream(req, res, source);
  } catch (err: unknown) {
    console.error('[ServeStatic] Error:', err);
    if (!res.headersSent) {
      const msg = (err as Error).message || '';
      if (msg.includes('Access denied')) {
        res.status(403).send('Access denied.');
      } else {
        res.status(500).send('Internal server error.');
      }
    }
  }
}

/**
 * Creates an Express application for media operations.
 */
export function createMediaApp(options: MediaHandlerOptions) {
  const { ffmpegPath, cacheDir } = options;

  // Initialize MediaAnalyzer cache dir
  MediaAnalyzer.getInstance().setCacheDir(cacheDir);

  const app = express();

  app.use(cors());
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const fileLimiter = createRateLimiter(
    RATE_LIMIT_FILE_WINDOW_MS,
    RATE_LIMIT_FILE_MAX_REQUESTS,
    'Too many requests. Please slow down.',
  );

  // Metadata Route
  app.get(MediaRoutes.METADATA, fileLimiter, async (req, res) => {
    const filePath = getQueryParam(req.query, 'file');
    if (!filePath) {
      res.status(400).send('Missing file parameter');
      return;
    }
    await serveMetadata(req, res, filePath, ffmpegPath);
  });

  // Streaming Route
  app.get(MediaRoutes.STREAM, fileLimiter, async (req, res) => {
    // Logic handled inside handleStreamRequest by reading req.query
    await handleStreamRequest(req, res, ffmpegPath);
  });

  // Thumbnail Route
  app.get(MediaRoutes.THUMBNAIL, fileLimiter, async (req, res) => {
    const filePath = getQueryParam(req.query, 'file');
    if (!filePath) {
      res.status(400).send('Missing file parameter');
      return;
    }
    await serveThumbnail(req, res, filePath, ffmpegPath, cacheDir);
  });

  // Heatmap Route
  app.get(MediaRoutes.HEATMAP, fileLimiter, async (req, res) => {
    const filePath = getQueryParam(req.query, 'file');
    if (!filePath) {
      res.status(400).send('Missing file parameter');
      return;
    }
    await serveHeatmap(req, res, filePath);
  });

  // HLS Routes
  app.get('/api/hls/master.m3u8', fileLimiter, async (req, res) => {
    const filePath = getQueryParam(req.query, 'file');
    if (!filePath) {
      res.status(400).send('Missing file parameter');
      return;
    }
    await serveHlsMaster(req, res, filePath);
  });

  app.get('/api/hls/playlist.m3u8', fileLimiter, async (req, res) => {
    const filePath = getQueryParam(req.query, 'file');
    if (!filePath) {
      res.status(400).send('Missing file parameter');
      return;
    }
    await serveHlsPlaylist(req, res, filePath);
  });

  app.get('/api/hls/segment/:segment', fileLimiter, async (req, res) => {
    const filePath = getQueryParam(req.query, 'file');
    const segment = req.params.segment;
    if (!filePath || !segment) {
      res.status(400).send('Missing file or segment parameter');
      return;
    }
    await serveHlsSegment(req, res, filePath, segment as string);
  });

  // Static File Serving (Fallback)
  app.use(fileLimiter, async (req, res) => {
    const requestedPath = normalizeFilePath(req.path);
    await serveStaticFile(req, res, requestedPath);
  });

  return app;
}

/**
 * Helper: Creates an HTTP URL result.
 */
function createHttpUrl(
  filePath: string,
  serverPort: number,
  isLarge: boolean,
): GenerateUrlResult {
  if (serverPort === 0) {
    return {
      type: 'error',
      message: isLarge
        ? 'Local server not ready to stream large file.'
        : 'Local server not ready to stream file.',
    };
  }
  const encodedPath = encodeURIComponent(filePath);
  return {
    type: 'http-url',
    url: `http://localhost:${serverPort}${MediaRoutes.STREAM}?file=${encodedPath}`,
  };
}

/**
 * Helper: Creates a Data URL result by reading the file stream.
 */
async function createDataUrl(
  filePath: string,
  provider: FileSystemProvider,
  mimeType: string,
): Promise<GenerateUrlResult> {
  const result = await provider.getStream(filePath);
  const chunks: Buffer[] = [];
  for await (const chunk of result.stream) {
    chunks.push(Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  const dataURL = `data:${mimeType};base64,${buffer.toString('base64')}`;
  return { type: 'data-url', url: dataURL };
}

/**
 * Generates a URL (Data URL or HTTP URL) for loading a file.
 */
export async function generateFileUrl(
  filePath: string,
  options: GenerateUrlOptions,
): Promise<GenerateUrlResult> {
  try {
    const { serverPort, preferHttp } = options;
    const provider = getProvider(filePath);

    // [SECURITY] Check access for all files (local and drive)
    const auth = await authorizeFilePath(filePath);
    if (!auth.isAllowed)
      return { type: 'error', message: auth.message || 'Access denied' };

    const meta = await provider.getMetadata(filePath);
    const isLarge = meta.size > DATA_URL_THRESHOLD_BYTES;

    if (preferHttp || isLarge) {
      return createHttpUrl(filePath, serverPort, isLarge);
    }

    const mimeType = meta.mimeType || 'application/octet-stream';
    return createDataUrl(filePath, provider, mimeType);
  } catch (error: unknown) {
    console.error(
      `[media-handler] Error processing ${filePath} in generateFileUrl:`,
      error,
    );
    return {
      type: 'error',
      message: (error as Error).message || 'Unknown error processing file.',
    };
  }
}
