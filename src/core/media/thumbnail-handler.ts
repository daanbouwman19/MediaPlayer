import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import { Response } from 'express';
import PQueue from 'p-queue';
import { getThumbnailCachePath, isDrivePath } from './media-utils.ts';
import { getFileIdentity } from './file-identity.ts';
import { SUPPORTED_IMAGE_EXTENSIONS_SET } from './constants.ts';
import { SharedTask } from './utils/shared-task.ts';
import { CacheSweeper } from './utils/cache-maintenance.ts';
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

/** Seek position for video thumbnails, past typical black lead-in frames. */
const THUMBNAIL_SEEK_SECONDS = 1;
/**
 * Browsers revalidate daily (a 304 when unchanged), so an edited file's new
 * thumbnail shows up; the server-side key already includes the file identity.
 */
const THUMBNAIL_CACHE_CONTROL =
  'public, max-age=86400, stale-while-revalidate=604800';
/**
 * Drive thumbnails are keyed by file ID only, because checking the revision
 * would cost an API call per request. They are re-fetched after this long.
 */
const DRIVE_THUMBNAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DRIVE_THUMBNAIL_TIMEOUT_MS = 20 * 1000;
/** A failed generation is not retried for this long (or until the file changes). */
const LOCAL_FAILURE_TTL_MS = 60 * 60 * 1000;
const DRIVE_FAILURE_TTL_MS = 10 * 60 * 1000;
const MAX_REMEMBERED_FAILURES = 5000;

// 64 hex digits: SHA-256 names. 32: names from the former MD5 key, still
// matched so the sweeper removes those files.
const THUMBNAIL_FILE = /^(?:[0-9a-f]{64}|[0-9a-f]{32})\.jpg$/;
const THUMBNAIL_TEMP_FILE =
  /^(?:[0-9a-f]{64}|[0-9a-f]{32})\.jpg\.[0-9a-f-]+\.tmp\.jpg$/;
const thumbnailSweeper = new CacheSweeper({
  isEntry: (name) => THUMBNAIL_FILE.test(name),
  isTempFile: (name) => THUMBNAIL_TEMP_FILE.test(name),
  maxAgeMs: 90 * 24 * 60 * 60 * 1000,
  tempMaxAgeMs: 60 * 60 * 1000,
});

/** In-flight generations by cache file, shared by concurrent requests. */
const inFlight = new Map<string, SharedTask<void>>();
/** Cache files whose generation recently failed, with their expiry time. */
const recentFailures = new Map<string, number>();

/** @internal Used for testing */
export function resetThumbnailState(): void {
  for (const task of inFlight.values()) task.cancel();
  inFlight.clear();
  recentFailures.clear();
  thumbnailQueue.clear();
}

function hasRecentFailure(cacheFile: string): boolean {
  const expiresAt = recentFailures.get(cacheFile);
  if (expiresAt === undefined) return false;
  if (expiresAt > Date.now()) return true;
  recentFailures.delete(cacheFile);
  return false;
}

function rememberFailure(cacheFile: string, ttlMs: number): void {
  if (recentFailures.size >= MAX_REMEMBERED_FAILURES) {
    const oldest = recentFailures.keys().next().value;
    if (oldest !== undefined) recentFailures.delete(oldest);
  }
  recentFailures.set(cacheFile, Date.now() + ttlMs);
}

/**
 * Runs `work` for `cacheFile` unless it is already running, and waits for it.
 * The work is cancelled once every waiting request has disconnected, and a
 * failure is remembered so the next request does not redo it.
 */
function produceOnce(
  cacheFile: string,
  failureTtlMs: number,
  work: (signal: AbortSignal) => Promise<void>,
  clientSignal: AbortSignal,
): Promise<void> {
  let task = inFlight.get(cacheFile);
  // Cancelled work stays listed while it tears down; start over instead of
  // failing this request with its AbortError.
  if (!task || task.signal.aborted) {
    const created = new SharedTask(work);
    const cleanup = () => {
      if (inFlight.get(cacheFile) === created) inFlight.delete(cacheFile);
    };
    created.promise.then(cleanup, () => {
      cleanup();
      if (!created.signal.aborted) rememberFailure(cacheFile, failureTtlMs);
    });
    inFlight.set(cacheFile, created);
    task = created;
  }
  return task.join(clientSignal);
}

/** Aborts when the client goes away before the response has been sent. */
function watchClientDisconnect(res: Response) {
  const controller = new AbortController();
  const onClose = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.on('close', onClose);
  return {
    signal: controller.signal,
    dispose: () => res.off('close', onClose),
  };
}

function tempPathFor(cacheFile: string): string {
  return `${cacheFile}.${crypto.randomUUID()}.tmp.jpg`;
}

async function hasContent(file: string): Promise<boolean> {
  try {
    return (await fsPromises.stat(file)).size > 0;
  } catch {
    return false;
  }
}

/** Moves a completely written temp file into place, so readers never see a partial file. */
async function publish(tempFile: string, cacheFile: string): Promise<void> {
  try {
    await fsPromises.rename(tempFile, cacheFile);
  } catch (err) {
    // Windows can refuse to replace a file that is being read; a complete
    // copy is already in place in that case.
    if (!(await hasContent(cacheFile))) throw err;
  }
}

function isImagePath(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS_SET.has(
    path.extname(filePath).toLowerCase(),
  );
}

async function renderThumbnail(
  filePath: string,
  cacheFile: string,
  ffmpegPath: string,
  signal: AbortSignal,
): Promise<void> {
  const tempFile = tempPathFor(cacheFile);
  // Images have a single frame. For videos, a clip shorter than the seek
  // position yields nothing, so fall back to the first frame.
  const seeks = isImagePath(filePath) ? [0] : [THUMBNAIL_SEEK_SECONDS, 0];
  try {
    for (const seek of seeks) {
      const args = getThumbnailArgs(filePath, tempFile, seek);
      const { code, stderr } = await runFFmpeg(
        ffmpegPath,
        args,
        undefined,
        signal,
      );
      signal.throwIfAborted();
      if (code !== 0) {
        throw new Error(`FFmpeg failed with code ${code}: ${stderr}`);
      }
      if (await hasContent(tempFile)) {
        await publish(tempFile, cacheFile);
        return;
      }
    }
    throw new Error('FFmpeg exited successfully but wrote no thumbnail');
  } finally {
    await fsPromises.rm(tempFile, { force: true }).catch(() => {});
  }
}

/**
 * Waits for the provider's thumbnail stream, but gives up after a timeout or
 * when aborted, destroying a stream that arrives too late.
 */
function awaitProviderStream(
  pending: Promise<Readable | null>,
  signal: AbortSignal,
): Promise<Readable | null> {
  return new Promise((resolve, reject) => {
    let done = false;
    const giveUp = (err: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(err);
    };
    const onAbort = () =>
      giveUp(new DOMException('The operation was aborted.', 'AbortError'));
    const timer = setTimeout(
      () => giveUp(new Error('Timed out waiting for the provider thumbnail')),
      DRIVE_THUMBNAIL_TIMEOUT_MS,
    );
    signal.addEventListener('abort', onAbort, { once: true });

    pending.then(
      (stream) => {
        if (done) {
          stream?.destroy();
          return;
        }
        done = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(stream);
      },
      (err: unknown) =>
        giveUp(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

async function downloadProviderThumbnail(
  filePath: string,
  cacheFile: string,
  signal: AbortSignal,
): Promise<void> {
  const provider = getProvider(filePath);
  const stream = await awaitProviderStream(
    provider.getThumbnailStream(filePath),
    signal,
  );
  if (!stream) throw new Error('No thumbnail available');

  const tempFile = tempPathFor(cacheFile);
  try {
    // pipeline() handles errors on both sides (network reset, ENOSPC, ...)
    // and destroys both streams, so nothing is left half-written or unhandled.
    await pipeline(stream, fs.createWriteStream(tempFile), {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(DRIVE_THUMBNAIL_TIMEOUT_MS),
      ]),
    });
    if (!(await hasContent(tempFile))) {
      throw new Error('Provider returned an empty thumbnail');
    }
    await publish(tempFile, cacheFile);
  } finally {
    await fsPromises.rm(tempFile, { force: true }).catch(() => {});
  }
}

function sendThumbnailFile(
  res: Response,
  cacheFile: string,
  callback: (err: unknown) => void,
): void {
  res.sendFile(
    cacheFile,
    {
      // The path is built by the server; its parents may be dot-directories
      // (e.g. ~/.config on Linux), which send would otherwise refuse with 404.
      dotfiles: 'allow',
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': THUMBNAIL_CACHE_CONTROL,
      },
    },
    callback,
  );
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
    // Use res.sendFile instead of fs.access + fs.createReadStream.
    // This saves a syscall and leverages kernel sendfile optimization.
    // If file doesn't exist, we get an error in callback and return false.
    sendThumbnailFile(res, cacheFile, (err: unknown) => {
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
    });
  });
}

/**
 * Helper: Generates a thumbnail using local FFmpeg and serves it.
 * @param clientSignal Aborts when the requester disconnects; the generation
 * is cancelled if no other request is waiting for the same thumbnail.
 */
export async function generateLocalThumbnail(
  res: Response,
  filePath: string,
  cacheFile: string,
  ffmpegPath: string | null,
  clientSignal: AbortSignal = new AbortController().signal,
): Promise<void> {
  // Use validateFileAccess to enforce security and get realPath
  const access = await validateFileAccess(filePath);
  if (handleAccessCheck(res, access)) return;
  const authorizedPath = access.success ? access.path : '';

  if (!ffmpegPath) {
    res.status(500).send('FFmpeg binary not found');
    return;
  }

  if (hasRecentFailure(cacheFile)) {
    res.status(500).send('Generation failed');
    return;
  }

  try {
    await produceOnce(
      cacheFile,
      LOCAL_FAILURE_TTL_MS,
      (signal) =>
        thumbnailQueue.add(
          () => renderThumbnail(authorizedPath, cacheFile, ffmpegPath, signal),
          { signal },
        ),
      clientSignal,
    );
  } catch (err) {
    if (clientSignal.aborted) return; // Nobody left to answer.
    console.error('[Thumbnail] Generation failed:', err);
    if (!res.headersSent) {
      res.status(500).send('Generation failed');
    }
    return;
  }

  sendThumbnailFile(res, cacheFile, (err: unknown) => {
    if (err) {
      console.error('[Thumbnail] Error sending generated file:', err);
      if (!res.headersSent) res.status(500).end();
    }
  });
}

async function cacheAgeMs(cacheFile: string): Promise<number | null> {
  try {
    return Date.now() - (await fsPromises.stat(cacheFile)).mtimeMs;
  } catch {
    return null;
  }
}

/** Serves a Drive thumbnail from the cache, refreshing it from Drive when missing or old. */
async function serveProviderThumbnail(
  res: Response,
  filePath: string,
  cacheFile: string,
  clientSignal: AbortSignal,
): Promise<void> {
  const age = await cacheAgeMs(cacheFile);
  if (
    age !== null &&
    age < DRIVE_THUMBNAIL_TTL_MS &&
    (await tryServeFromCache(res, cacheFile))
  ) {
    return;
  }

  if (!hasRecentFailure(cacheFile)) {
    try {
      await produceOnce(
        cacheFile,
        DRIVE_FAILURE_TTL_MS,
        (signal) => downloadProviderThumbnail(filePath, cacheFile, signal),
        clientSignal,
      );
      if (await tryServeFromCache(res, cacheFile)) return;
    } catch (e) {
      if (clientSignal.aborted) return;
      console.warn('[Thumbnail] Provider fetch failed:', e);
    }
  }

  // Refreshing failed: an old thumbnail is better than none.
  if (age !== null && (await tryServeFromCache(res, cacheFile))) return;
  if (!res.headersSent) res.status(404).end();
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
  // Registered before any await so an early disconnect still cancels work.
  const client = watchClientDisconnect(res);
  try {
    // [SECURITY] Validate access before checking cache to prevent IDOR on cached thumbnails
    const access = await validateFileAccess(filePath);
    if (handleAccessCheck(res, access)) return;
    const authorizedPath = access.success ? access.path : '';
    thumbnailSweeper.maybeSweep(cacheDir);

    // Ensure GDrive files don't fall through to local FS if provider fetch failed
    if (isDrivePath(authorizedPath)) {
      const cacheFile = getThumbnailCachePath(authorizedPath, cacheDir);
      await serveProviderThumbnail(
        res,
        authorizedPath,
        cacheFile,
        client.signal,
      );
      return;
    }

    // 1. Check Cache (keyed by the file's current size + mtime)
    const identity = await getFileIdentity(authorizedPath);
    const cacheFile = getThumbnailCachePath(authorizedPath, cacheDir, identity);
    if (await tryServeFromCache(res, cacheFile)) {
      thumbnailSweeper.touch(cacheFile);
      return;
    }

    // 2. Fallback to FFmpeg (Local)
    await generateLocalThumbnail(
      res,
      authorizedPath,
      cacheFile,
      ffmpegPath,
      client.signal,
    );
  } finally {
    client.dispose();
  }
}
