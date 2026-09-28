import fs from 'fs';
import { Readable } from 'stream';
import {
  getDriveBackend,
  getDriveFileMetadataCached,
  parseDriveFileSize,
  type DriveCachedFile,
} from './drive-backend.ts';

/**
 * How long a Drive download may go without delivering a byte while the
 * consumer is waiting for data. A connection that silently dies would
 * otherwise leave ffmpeg (or a browser) waiting forever.
 */
export const DRIVE_STREAM_STALL_TIMEOUT_MS = 60_000;

/**
 * Streams the inclusive byte range [start, end] of a Drive file.
 *
 * Bytes that are already in the local cache file (the background download
 * writes a growing prefix of the file) are read from disk and the rest is
 * fetched from Drive, so the stream always delivers exactly
 * `end - start + 1` bytes. If a source ends early the stream fails instead
 * of ending short, because callers have already promised that length in a
 * Content-Length header.
 */
class DriveRangeStream extends Readable {
  private source: Readable | null = null;
  private opening = false;
  private offset: number;
  /** Last byte to read from the cache file, or -1 once the cache is used up. */
  private cacheEnd: number;
  private stallTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly fileId: string,
    private readonly cache: DriveCachedFile | null,
    start: number,
    cacheEnd: number,
    private readonly end: number,
  ) {
    super();
    this.offset = start;
    this.cacheEnd = cache ? cacheEnd : -1;
  }

  override _read(): void {
    if (this.source) {
      this.armStallTimer();
      this.source.resume();
    } else if (!this.opening) {
      void this.openNextSource();
    }
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    this.clearStallTimer();
    this.source?.destroy();
    this.source = null;
    callback(error);
  }

  /** Opens the cache file or the Drive download for the next bytes. */
  private async openNextSource(): Promise<void> {
    if (this.destroyed) return;
    if (this.offset > this.end) {
      this.push(null);
      return;
    }
    this.opening = true;
    try {
      if (this.cache && this.offset <= this.cacheEnd) {
        this.attach(
          this.cache.readRange(this.offset, this.cacheEnd),
          this.cacheEnd,
          true,
        );
        return;
      }
      // The Drive request itself can hang too, so the watchdog covers it.
      this.armStallTimer();
      const stream = await getDriveBackend().getFileStream(this.fileId, {
        start: this.offset,
        end: this.end,
      });
      if (this.destroyed) {
        stream.destroy();
        return;
      }
      this.attach(stream, this.end, false);
    } catch (err) {
      this.destroy(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.opening = false;
    }
  }

  private attach(source: Readable, lastByte: number, fromCache: boolean) {
    this.source = source;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      this.clearStallTimer();
      source.removeListener('data', onData);
      source.destroy();
      this.source = null;

      if (fromCache) {
        // A cache file that turns out shorter than it was (evicted or
        // truncated) is not an error: fetch whatever is left from Drive.
        this.cacheEnd = -1;
      } else if (this.offset <= this.end) {
        this.destroy(
          new Error(
            `Drive stream for ${this.fileId} ended at byte ${this.offset}, expected ${this.end + 1}`,
          ),
        );
        return;
      }
      void this.openNextSource();
    };

    const onData = (chunk: Buffer) => {
      const remaining = lastByte - this.offset + 1;
      const piece =
        chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
      this.offset += piece.length;
      const wantsMore = this.push(piece);
      if (this.offset > lastByte) {
        finish();
      } else if (wantsMore) {
        this.armStallTimer();
      } else {
        // Backpressure: the consumer is not reading, so this is not a stall.
        this.clearStallTimer();
        source.pause();
      }
    };

    source.on('data', onData);
    source.once('end', finish);
    source.once('error', (err: Error) => {
      if (done) return;
      if (fromCache) {
        console.warn(
          '[DriveStream] Cache read failed for %s, continuing from Drive:',
          this.fileId,
          err,
        );
        finish();
      } else {
        this.destroy(err);
      }
    });
    this.armStallTimer();
  }

  private armStallTimer() {
    this.clearStallTimer();
    this.stallTimer = setTimeout(() => {
      this.destroy(
        new Error(
          `Drive stream for ${this.fileId} stalled for ${DRIVE_STREAM_STALL_TIMEOUT_MS} ms`,
        ),
      );
    }, DRIVE_STREAM_STALL_TIMEOUT_MS);
    this.stallTimer.unref();
  }

  private clearStallTimer() {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }
}

async function getCachedFile(fileId: string): Promise<DriveCachedFile | null> {
  try {
    return await getDriveBackend().getCachedFile(fileId);
  } catch (e) {
    console.warn(
      '[DriveStream] Cache unavailable for %s, streaming from Drive:',
      fileId,
      e,
    );
    return null;
  }
}

async function getCachedBytes(cachePath: string): Promise<number> {
  try {
    return (await fs.promises.stat(cachePath)).size;
  } catch {
    return 0;
  }
}

/**
 * Retrieves a stream for a Drive file (or an inclusive byte range of it),
 * using the part of the local cache that is already downloaded.
 *
 * The returned stream always carries exactly `length` bytes.
 */
export async function getDriveStreamWithCache(
  fileId: string,
  range?: { start?: number; end?: number },
): Promise<{ stream: Readable; length: number }> {
  // Also starts (or resumes) the background download of the file.
  const cached = await getCachedFile(fileId);

  let totalSize: number;
  try {
    totalSize = parseDriveFileSize(await getDriveFileMetadataCached(fileId));
  } catch (err) {
    // Offline: the cache still knows the size of the file it downloaded.
    if (!cached || cached.totalSize <= 0) throw err;
    totalSize = cached.totalSize;
  }

  const start = range?.start ?? 0;
  const end = Math.min(range?.end ?? totalSize - 1, totalSize - 1);
  if (totalSize === 0 && start === 0) {
    return { stream: Readable.from([]), length: 0 };
  }
  if (!Number.isSafeInteger(start) || start < 0 || start > end) {
    throw new RangeError(
      `Invalid range requested for ${fileId}: start=${start}, end=${end}, size=${totalSize}`,
    );
  }
  const length = end - start + 1;

  let cache: DriveCachedFile | null = null;
  let cacheEnd = -1;
  // A cache sized for a different revision of the file cannot be trusted.
  if (cached && cached.totalSize === totalSize) {
    const cachedBytes = Math.min(await getCachedBytes(cached.path), totalSize);
    if (cachedBytes > start) {
      cache = cached;
      cacheEnd = Math.min(end, cachedBytes - 1);
    }
  }

  return {
    stream: new DriveRangeStream(fileId, cache, start, cacheEnd, end),
    length,
  };
}
