import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { pipeline } from 'stream/promises';
import type { Readable } from 'stream';
import type { drive_v3 } from 'googleapis';
import {
  getDriveFileMetadata,
  openDriveFileDownload,
  type DriveFileDownload,
} from './google-drive-service.ts';
import type {
  DriveCacheProgressEvent,
  DriveCacheStatus,
} from '../shared/ipc/media.contract.ts';

/** Largest total size the offline cache may occupy on disk. */
const MAX_CACHE_BYTES = 5 * 1024 ** 3; // 5 GB
/** How long fetched Drive metadata is trusted before it is checked again. */
const METADATA_TTL_MS = 5 * 60 * 1000;
/** Metadata records kept before expired ones are pruned. */
const METADATA_CACHE_PRUNE_SIZE = 500;
/** Minimum gap between two progress events for the same file (~4/s). */
const PROGRESS_INTERVAL_MS = 250;
const MANIFEST_VERSION = 1;
/**
 * How long a background download may go without receiving a byte before it
 * is treated as dead. A connection left half-open by a network drop (Wi-Fi
 * switch, sleep/resume, NAT timeout) never errors or ends by itself, so
 * without this the file would show as syncing until the app restarts.
 */
export const DRIVE_CACHE_STALL_TIMEOUT_MS = 60_000;

// Every cache entry is a pair of files, `<fileId>.<rev>.data` holding the
// bytes and `<fileId>.<rev>.json` describing them, where <rev> is a digest of
// the Drive content revision. A new revision therefore never shares a file
// with an old one.
const ENTRY_FILE = /^([A-Za-z0-9_-]+)\.([0-9a-f]{16})\.(data|json)$/;

/** What the cache needs to know about a file on Drive. */
interface DriveFileInfo {
  size: number;
  mimeType: string;
  /** Identifies the content revision; it changes whenever the bytes do. */
  revision: string;
}

interface CacheEntry extends DriveFileInfo {
  fileId: string;
  dataPath: string;
  manifestPath: string;
}

interface CacheManifest extends DriveFileInfo {
  version: typeof MANIFEST_VERSION;
  fileId: string;
}

interface ActiveDownload {
  entry: CacheEntry;
  downloadedBytes: number;
  lastProgressAt: number;
  source: Readable | null;
  aborted: boolean;
  /** Settles once bytes flow into the cache file, or rejects if the start failed. */
  started: Promise<void>;
  /** Settles when the download has ended, successfully or not. Never rejects. */
  done: Promise<void>;
}

export interface CachedDriveFile {
  /** The cache file. It may be partial, or missing when the file isn't cached. */
  path: string;
  totalSize: number;
  mimeType: string;
}

interface DriveCacheEvents {
  progress: [DriveCacheProgressEvent];
}

// Drive ids are URL-safe; anything else could steer the cache file name
// (path separators, '..', or ':' for an NTFS alternate data stream).
const DRIVE_FILE_ID = /^[A-Za-z0-9_-]+$/;

function assertValidFileId(fileId: unknown): asserts fileId is string {
  if (typeof fileId !== 'string' || !DRIVE_FILE_ID.test(fileId)) {
    throw new Error('Invalid fileId');
  }
}

function toFileInfo(meta: drive_v3.Schema$File): DriveFileInfo {
  const size = Number(meta.size ?? 0);
  // The content checksum is the most precise revision marker; when Drive
  // reports none, fall back to the head revision id, then the change time.
  let revision: string;
  if (meta.md5Checksum) revision = `md5:${meta.md5Checksum}`;
  else if (meta.headRevisionId) revision = `rev:${meta.headRevisionId}`;
  else if (meta.modifiedTime) revision = `mtime:${meta.modifiedTime}`;
  else revision = `size:${size}`;
  return {
    size: Number.isFinite(size) && size >= 0 ? size : 0,
    mimeType: meta.mimeType || 'video/mp4',
    revision,
  };
}

function revisionDigest(revision: string): string {
  return crypto
    .createHash('sha256')
    .update(revision)
    .digest('hex')
    .slice(0, 16);
}

function parseManifest(raw: string): CacheManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { version, fileId, revision, size, mimeType } = record;
  if (
    version !== MANIFEST_VERSION ||
    typeof fileId !== 'string' ||
    typeof revision !== 'string' ||
    typeof size !== 'number' ||
    !Number.isFinite(size) ||
    size < 0 ||
    typeof mimeType !== 'string'
  ) {
    return null;
  }
  return { version, fileId, revision, size, mimeType };
}

/** True when a ranged response really continues the file at `offset`. */
function resumesAt(
  download: DriveFileDownload,
  offset: number,
  size: number,
): boolean {
  if (download.status !== 206 || !download.contentRange) return false;
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(
    download.contentRange.trim(),
  );
  if (!match) return false;
  const total = match[3] === '*' ? size : Number(match[3]);
  return Number(match[1]) === offset && total === size;
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? Math.min(1, part / whole) : 1;
}

function formatGigabytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function statSize(filePath: string): Promise<number> {
  try {
    return (await fsPromises.stat(filePath)).size;
  } catch {
    return 0;
  }
}

/** Deletes a file; a missing file counts as deleted. */
async function removeFile(filePath: string): Promise<boolean> {
  try {
    await fsPromises.unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    console.error('[DriveCache] Failed to delete %s:', filePath, err);
    return false;
  }
}

/**
 * Keeps local copies of Google Drive files so they play without re-fetching
 * and stay available offline. Entries persist across restarts, are keyed by
 * Drive revision, and are evicted least-recently-used first to stay under the
 * size cap.
 */
class DriveCacheManager extends EventEmitter<DriveCacheEvents> {
  private readonly cacheDir: string;
  private readonly maxCacheBytes: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly activeDownloads = new Map<string, ActiveDownload>();
  private readonly metadataCache = new Map<
    string,
    { info: Promise<DriveFileInfo>; fetchedAt: number }
  >();
  private readonly accessOrder = new Map<string, number>();
  private readonly fileLocks = new Map<string, Promise<void>>();
  private evictionQueue: Promise<void> = Promise.resolve();
  private readonly indexReady: Promise<void>;

  constructor(cacheDir: string, options: { maxCacheBytes?: number } = {}) {
    super();
    this.cacheDir = cacheDir;
    this.maxCacheBytes = options.maxCacheBytes ?? MAX_CACHE_BYTES;
    fs.mkdirSync(cacheDir, { recursive: true });
    this.indexReady = this.loadIndex();
  }

  /**
   * Returns the cache file for `fileId`, starting or resuming its download
   * in the background when needed. The file is partial (or not there yet)
   * while the download runs, and never exists for files too large to cache.
   */
  public async getCachedFilePath(fileId: string): Promise<CachedDriveFile> {
    assertValidFileId(fileId);
    await this.indexReady;
    this.accessOrder.set(fileId, Date.now());
    const { file } = await this.withFileLock(fileId, () =>
      this.ensureCached(fileId, false),
    );
    return file;
  }

  public async getCacheStatus(fileId: string): Promise<DriveCacheStatus> {
    if (fileId === '') {
      return { status: 'cloud', progress: 0 };
    }
    assertValidFileId(fileId);
    await this.indexReady;

    const active = this.activeDownloads.get(fileId);
    if (active) {
      return {
        status: 'syncing',
        progress: ratio(active.downloadedBytes, active.entry.size),
      };
    }

    const entry = this.entries.get(fileId);
    if (!entry) {
      return { status: 'cloud', progress: 0 };
    }

    // A cached copy only counts while it matches the file on Drive. When
    // Drive can't be reached, trust it: that is what offline use is for.
    try {
      const info = await this.getFileInfo(fileId);
      if (info.revision !== entry.revision) {
        return { status: 'cloud', progress: 0 };
      }
    } catch {
      // Offline or signed out.
    }

    const localSize = await statSize(entry.dataPath);
    if (localSize >= entry.size) {
      return { status: 'ready', progress: 1 };
    }
    return { status: 'cloud', progress: ratio(localSize, entry.size) };
  }

  /**
   * Starts (or resumes) caching `fileId` for offline use and resolves once
   * the download is running. Rejects when it can't be cached, so the caller
   * can report why.
   */
  public async triggerDownload(fileId: string): Promise<void> {
    assertValidFileId(fileId);
    await this.indexReady;
    this.accessOrder.set(fileId, Date.now());
    const { started } = await this.withFileLock(fileId, () =>
      this.ensureCached(fileId, true),
    );
    // Waiting outside the lock keeps streaming requests for the same file
    // from queueing behind Drive's response.
    await started;
  }

  /** Drops the cached copy of `fileId`, stopping its download if one runs. */
  public async invalidateFile(fileId: string): Promise<void> {
    assertValidFileId(fileId);
    await this.indexReady;
    await this.withFileLock(fileId, async () => {
      this.metadataCache.delete(fileId);
      this.accessOrder.delete(fileId);
      const entry = this.entries.get(fileId);
      if (entry) {
        await this.removeEntry(entry);
      }
    });
  }

  /** Deletes every cached file, stopping downloads in progress first. */
  public async clearCache(): Promise<void> {
    await this.indexReady;
    const downloads = Array.from(this.activeDownloads.values());
    for (const download of downloads) {
      this.abortDownload(download);
    }
    await Promise.all(downloads.map((download) => download.done));
    await Promise.all(
      Array.from(this.entries.values(), (entry) =>
        this.withFileLock(entry.fileId, () => this.removeEntry(entry)),
      ),
    );
    this.metadataCache.clear();
    this.accessOrder.clear();
    console.log('[DriveCache] Cache cleared.');
  }

  /**
   * Stops downloads in progress. Cached and partial files stay on disk, so
   * they are still available (or resume) in the next session.
   */
  public shutdown(): void {
    for (const download of this.activeDownloads.values()) {
      this.abortDownload(download);
    }
  }

  /**
   * Decides what `fileId` needs (nothing, a resume or a fresh download) and
   * starts it. Runs under the file's lock. `started` settles once a download
   * that is running for the file has got going, or rejects if it couldn't.
   */
  private async ensureCached(
    fileId: string,
    forOffline: boolean,
  ): Promise<{ file: CachedDriveFile; started: Promise<void> }> {
    let info: DriveFileInfo | null = null;
    try {
      info = await this.getFileInfo(fileId);
    } catch (err) {
      if (forOffline) throw err;
      console.warn(
        '[DriveCache] Failed to fetch metadata for %s:',
        fileId,
        err,
      );
    }

    let entry = this.entries.get(fileId);
    if (!info) {
      // Offline: serve whatever copy is on disk, but never resume it, since
      // its revision can't be checked.
      if (entry) {
        const file = {
          path: entry.dataPath,
          totalSize: entry.size,
          mimeType: entry.mimeType,
        };
        return { file, started: Promise.resolve() };
      }
      throw new Error(`Drive metadata for ${fileId} is unavailable`);
    }

    if (entry && entry.revision !== info.revision) {
      console.log(
        '[DriveCache] %s changed on Drive; dropping old copy',
        fileId,
      );
      await this.removeEntry(entry);
      entry = undefined;
    }

    const target = entry ?? this.entryFor(fileId, info);
    const file: CachedDriveFile = {
      path: target.dataPath,
      totalSize: info.size,
      mimeType: info.mimeType,
    };

    if (info.size > this.maxCacheBytes) {
      // Caching it would evict everything else and then the file itself.
      if (forOffline) {
        throw new Error(
          `File is too large for the offline cache (${formatGigabytes(info.size)}; the limit is ${formatGigabytes(this.maxCacheBytes)})`,
        );
      }
      return { file, started: Promise.resolve() };
    }

    const active = this.activeDownloads.get(fileId);
    if (active) {
      return { file, started: active.started };
    }

    let localSize = entry ? await statSize(target.dataPath) : 0;
    if (entry && localSize === info.size) {
      return { file, started: Promise.resolve() };
    }
    if (localSize > info.size) {
      localSize = 0; // Longer than the file itself: not a prefix of it.
    }

    // Streaming callers don't wait for this: they serve what is cached and
    // fetch the rest from Drive.
    return { file, started: this.startDownload(target, localSize).started };
  }

  private startDownload(entry: CacheEntry, startByte: number): ActiveDownload {
    let markStarted!: () => void;
    let failStart!: (err: unknown) => void;
    const started = new Promise<void>((resolve, reject) => {
      markStarted = resolve;
      failStart = reject;
    });
    // Callers that don't wait for the start must not leave the rejection
    // unhandled; those that do still receive it.
    started.catch(() => undefined);

    const download: ActiveDownload = {
      entry,
      downloadedBytes: startByte,
      lastProgressAt: 0,
      source: null,
      aborted: false,
      started,
      done: Promise.resolve(),
    };
    this.entries.set(entry.fileId, entry);
    this.activeDownloads.set(entry.fileId, download);

    download.done = this.runDownload(download, startByte, markStarted).then(
      () => {
        this.settle(download);
        this.emitProgress(download, 'ready');
        // Never evicts the file that just finished.
        void this.enforceCap(entry.fileId);
      },
      (err: unknown) => {
        // Settle before failing the start, so a caller retrying right away
        // gets a fresh download instead of this dead one.
        this.settle(download);
        failStart(err);
        if (download.aborted) return;
        console.error(
          '[DriveCache] Download failed for %s:',
          entry.fileId,
          err,
        );
        this.emitProgress(download, 'error', err);
      },
    );
    // Make room for the incoming bytes while the download starts.
    void this.enforceCap(entry.fileId);
    return download;
  }

  private async runDownload(
    download: ActiveDownload,
    startByte: number,
    markStarted: () => void,
  ): Promise<void> {
    const { entry } = download;
    let offset = startByte;
    if (offset === 0) {
      await this.writeManifest(entry);
    }
    if (download.aborted) throw new Error('Download aborted');

    let response = await openDriveFileDownload(entry.fileId, offset);
    if (
      !download.aborted &&
      offset > 0 &&
      !resumesAt(response, offset, entry.size)
    ) {
      // Drive ignored or shifted the range; appending would corrupt the file.
      console.warn(
        '[DriveCache] Drive did not resume %s at byte %d (status %d); restarting',
        entry.fileId,
        offset,
        response.status,
      );
      response.stream.destroy();
      offset = 0;
      response = await openDriveFileDownload(entry.fileId, 0);
    }

    const source = response.stream;
    download.source = source;
    if (download.aborted) {
      source.destroy();
      throw new Error('Download aborted');
    }
    download.downloadedBytes = offset;

    const fileStream = fs.createWriteStream(entry.dataPath, {
      flags: offset > 0 ? 'a' : 'w',
    });
    fileStream.once('ready', markStarted);
    // pipeline passes the first failure on to the other stream, so note which
    // side failed first: a read failure leaves a prefix worth resuming.
    const failure: { side: 'read' | 'write' | null } = { side: null };
    source.once('error', () => {
      failure.side ??= 'read';
    });
    source.once('close', () => {
      if (!source.readableEnded) failure.side ??= 'read';
    });
    fileStream.once('error', () => {
      failure.side ??= 'write';
    });
    let stallTimer: NodeJS.Timeout | null = null;
    const armStallTimer = (): void => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        // Surfaces as a read failure, so the prefix is kept for a resume.
        source.destroy(
          new Error(
            `Drive download of ${entry.fileId} stalled: no data for ${DRIVE_CACHE_STALL_TIMEOUT_MS / 1000} s`,
          ),
        );
      }, DRIVE_CACHE_STALL_TIMEOUT_MS);
      stallTimer.unref();
    };
    source.on('data', (chunk: Buffer) => {
      armStallTimer();
      download.downloadedBytes += chunk.length;
      this.reportProgress(download);
    });
    armStallTimer();

    try {
      // pipeline destroys both streams when either fails, so a write error
      // (disk full, file locked) can't leave the Drive response hanging open.
      await pipeline(source, fileStream);
    } catch (err) {
      if (failure.side === 'write') {
        // Nothing worth resuming from; free the space.
        await this.discardEntry(entry);
      }
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
    }

    const written = await statSize(entry.dataPath);
    if (written !== entry.size) {
      if (written > entry.size) {
        await this.discardEntry(entry);
      }
      throw new Error(
        `Drive download of ${entry.fileId} ended after ${written} of ${entry.size} bytes`,
      );
    }
  }

  private settle(download: ActiveDownload): void {
    const { fileId } = download.entry;
    if (this.activeDownloads.get(fileId) === download) {
      this.activeDownloads.delete(fileId);
    }
  }

  private abortDownload(download: ActiveDownload): void {
    download.aborted = true;
    download.source?.destroy();
  }

  private reportProgress(download: ActiveDownload): void {
    const now = Date.now();
    if (now - download.lastProgressAt < PROGRESS_INTERVAL_MS) return;
    download.lastProgressAt = now;
    this.emitProgress(download, 'syncing');
  }

  private emitProgress(
    download: ActiveDownload,
    status: DriveCacheProgressEvent['status'],
    error?: unknown,
  ): void {
    const { entry } = download;
    const downloadedBytes =
      status === 'ready' ? entry.size : download.downloadedBytes;
    const event: DriveCacheProgressEvent = {
      fileId: entry.fileId,
      status,
      progress: status === 'ready' ? 1 : ratio(downloadedBytes, entry.size),
      downloadedBytes,
      totalSize: entry.size,
    };
    if (error !== undefined) {
      event.error = errorMessage(error);
    }
    this.emit('progress', event);
  }

  private entryFor(fileId: string, info: DriveFileInfo): CacheEntry {
    const stem = path.join(
      this.cacheDir,
      `${fileId}.${revisionDigest(info.revision)}`,
    );
    return {
      fileId,
      size: info.size,
      mimeType: info.mimeType,
      revision: info.revision,
      dataPath: `${stem}.data`,
      manifestPath: `${stem}.json`,
    };
  }

  private async writeManifest(entry: CacheEntry): Promise<void> {
    const manifest: CacheManifest = {
      version: MANIFEST_VERSION,
      fileId: entry.fileId,
      revision: entry.revision,
      size: entry.size,
      mimeType: entry.mimeType,
    };
    await fsPromises.writeFile(entry.manifestPath, JSON.stringify(manifest));
  }

  /** Forgets an entry and deletes its files, stopping its download first. */
  private async removeEntry(entry: CacheEntry): Promise<boolean> {
    const active = this.activeDownloads.get(entry.fileId);
    if (active && active.entry === entry) {
      this.abortDownload(active);
      await active.done;
    }
    return this.discardEntry(entry);
  }

  /** Forgets an entry and deletes its files, leaving downloads alone. */
  private async discardEntry(entry: CacheEntry): Promise<boolean> {
    if (this.entries.get(entry.fileId) === entry) {
      this.entries.delete(entry.fileId);
    }
    const [dataRemoved, manifestRemoved] = await Promise.all([
      removeFile(entry.dataPath),
      removeFile(entry.manifestPath),
    ]);
    return dataRemoved && manifestRemoved;
  }

  private getFileInfo(fileId: string): Promise<DriveFileInfo> {
    const now = Date.now();
    const cached = this.metadataCache.get(fileId);
    if (cached && now - cached.fetchedAt < METADATA_TTL_MS) {
      return cached.info;
    }

    if (this.metadataCache.size >= METADATA_CACHE_PRUNE_SIZE) {
      for (const [id, record] of this.metadataCache) {
        if (now - record.fetchedAt >= METADATA_TTL_MS) {
          this.metadataCache.delete(id);
        }
      }
    }

    const info = getDriveFileMetadata(fileId).then(toFileInfo);
    const record = { info, fetchedAt: now };
    this.metadataCache.set(fileId, record);
    // Don't remember failures, so the next call asks Drive again.
    info.catch(() => {
      if (this.metadataCache.get(fileId) === record) {
        this.metadataCache.delete(fileId);
      }
    });
    return info;
  }

  /** Runs `task` once earlier tasks for the same file have finished. */
  private withFileLock<T>(fileId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.fileLocks.get(fileId) ?? Promise.resolve();
    const run = previous.then(task);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.fileLocks.set(fileId, tail);
    void tail.then(() => {
      if (this.fileLocks.get(fileId) === tail) {
        this.fileLocks.delete(fileId);
      }
    });
    return run;
  }

  private enforceCap(protectedFileId: string): Promise<void> {
    const pass = this.evictionQueue.then(() => this.evict(protectedFileId));
    this.evictionQueue = pass.catch((err: unknown) => {
      console.error('[DriveCache] Eviction failed:', err);
    });
    return this.evictionQueue;
  }

  /**
   * Evicts least-recently-used entries until the files on disk, plus the
   * bytes running downloads still have to write, fit under the cap.
   * Downloading entries and `protectedFileId` are never evicted.
   */
  private async evict(protectedFileId: string): Promise<void> {
    const candidates = await Promise.all(
      Array.from(this.entries.values(), async (entry) => {
        try {
          const stat = await fsPromises.stat(entry.dataPath);
          return {
            entry,
            size: stat.size,
            lastAccess: this.accessOrder.get(entry.fileId) ?? stat.mtimeMs,
          };
        } catch {
          return { entry, size: 0, lastAccess: 0 };
        }
      }),
    );

    let totalSize = 0;
    for (const candidate of candidates) {
      totalSize += candidate.size;
    }
    for (const download of this.activeDownloads.values()) {
      totalSize += Math.max(0, download.entry.size - download.downloadedBytes);
    }
    if (totalSize <= this.maxCacheBytes) return;

    candidates.sort((a, b) => a.lastAccess - b.lastAccess);
    for (const { entry, size } of candidates) {
      if (totalSize <= this.maxCacheBytes) break;
      if (entry.fileId === protectedFileId) continue;

      const removed = await this.withFileLock(entry.fileId, async () => {
        if (
          this.entries.get(entry.fileId) !== entry ||
          this.activeDownloads.has(entry.fileId)
        ) {
          return false;
        }
        return this.removeEntry(entry);
      });
      if (removed) {
        this.accessOrder.delete(entry.fileId);
        totalSize -= size;
        console.log('[DriveCache] Evicted %s (%d bytes)', entry.fileId, size);
      }
    }
  }

  /** Rebuilds the entry index from disk and drops files it can't trust. */
  private async loadIndex(): Promise<void> {
    let names: string[];
    try {
      names = await fsPromises.readdir(this.cacheDir);
    } catch (err) {
      console.error('[DriveCache] Failed to read cache directory:', err);
      return;
    }

    const present = new Set(names);
    const stale: string[] = [];
    const manifests: { name: string; fileId: string; digest: string }[] = [];
    for (const name of names) {
      const match = ENTRY_FILE.exec(name);
      if (!match) {
        // Entries from before revisions were tracked are named after the bare
        // Drive id. Their revision is unknown, so they can't be trusted.
        if (DRIVE_FILE_ID.test(name)) stale.push(name);
        continue;
      }
      const [, fileId = '', digest = '', kind] = match;
      if (kind === 'json') {
        manifests.push({ name, fileId, digest });
      } else if (!present.has(`${fileId}.${digest}.json`)) {
        stale.push(name); // Bytes without a manifest can't be validated.
      }
    }

    const loaded = await Promise.all(
      manifests.map(async ({ name, fileId, digest }) => {
        let manifest: CacheManifest | null = null;
        try {
          manifest = parseManifest(
            await fsPromises.readFile(path.join(this.cacheDir, name), 'utf8'),
          );
        } catch {
          // Unreadable: treated as corrupt below.
        }
        const valid =
          manifest !== null &&
          manifest.fileId === fileId &&
          revisionDigest(manifest.revision) === digest;
        return { name, fileId, digest, manifest: valid ? manifest : null };
      }),
    );

    for (const { name, fileId, digest, manifest } of loaded) {
      if (!manifest || this.entries.has(fileId)) {
        // Corrupt, or a second revision of a file that is already indexed.
        stale.push(name, `${fileId}.${digest}.data`);
        continue;
      }
      this.entries.set(fileId, this.entryFor(fileId, manifest));
    }

    await Promise.all(
      stale
        .filter((name) => present.has(name))
        .map((name) => removeFile(path.join(this.cacheDir, name))),
    );
  }
}

export type { DriveCacheManager };

let driveCacheManagerInstance: DriveCacheManager | null = null;

export const initializeDriveCacheManager = (
  cacheDir: string,
  options: { maxCacheBytes?: number } = {},
) => {
  if (!driveCacheManagerInstance) {
    driveCacheManagerInstance = new DriveCacheManager(cacheDir, options);
  }
  return driveCacheManagerInstance;
};

export const getDriveCacheManager = () => {
  if (!driveCacheManagerInstance) {
    throw new Error('DriveCacheManager has not been initialized.');
  }
  return driveCacheManagerInstance;
};

/**
 * Stops the cache's downloads on shutdown. The cached files are kept: they
 * are the offline copies the user asked for.
 */
export const cleanupDriveCacheManager = () => {
  if (!driveCacheManagerInstance) {
    return;
  }
  driveCacheManagerInstance.shutdown();
  driveCacheManagerInstance = null;
};
