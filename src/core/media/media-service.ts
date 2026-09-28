/**
 * @file Shared media service logic.
 * Orchestrates scanning, caching, and view count retrieval.
 */

import type { IMediaService } from './interfaces/media-service.interface.ts';
import type { IMediaRepository } from '../database/repositories/media-repository.interface.ts';
import type { IFileSystem } from './interfaces/file-system.interface.ts';
import type { IWorkerService } from './interfaces/worker-service.interface.ts';
import type { IMediaHandler } from './interfaces/media-handler.interface.ts';
import path from 'path';
import type { Album, MediaDirectory, MediaMetadata } from './types.ts';
import PQueue from 'p-queue';
import {
  METADATA_EXTRACTION_CONCURRENCY,
  METADATA_BATCH_SIZE,
  METADATA_VERIFICATION_THRESHOLD,
  SUPPORTED_VIDEO_EXTENSIONS_SET,
} from './constants.ts';
import { isDrivePath } from './media-utils.ts';
import type { MediaLibraryItem } from './types.ts';
import { decrypt } from '../auth/encryption.ts';
import { collapseNestedSources } from './utils/source-paths.ts';
import { isMetadataComplete } from './utils/metadata-status.ts';

/**
 * Settings key of the stamp that records which sources the cached album
 * tree was scanned from, and when.
 */
export const ALBUM_CACHE_STAMP_KEY = 'file_index_sources';

/**
 * How long an empty scan result is served from the cache. An empty library
 * usually means the sources are unreachable (e.g. an unmounted share), so it
 * is rescanned after a while instead of on every read.
 */
export const EMPTY_ALBUM_CACHE_TTL_MS = 5 * 60 * 1000;

interface AlbumCacheStamp {
  /** {@link getSourcesSignature} of the sources that were scanned. */
  sources: string;
  /** When the scan finished (ms since epoch). */
  scannedAt: number;
}

function parseAlbumCacheStamp(value: string | null): AlbumCacheStamp | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'sources' in parsed &&
      typeof parsed.sources === 'string' &&
      'scannedAt' in parsed &&
      typeof parsed.scannedAt === 'number'
    ) {
      return { sources: parsed.sources, scannedAt: parsed.scannedAt };
    }
  } catch {
    // A corrupt stamp is treated like a missing one: the cache is rescanned.
  }
  return null;
}

/** Paths of the active sources, in the order they are stored. */
function getActiveSourcePaths(directories: MediaDirectory[]): string[] {
  const active: string[] = [];
  for (const dir of directories) {
    if (dir.isActive) active.push(dir.path);
  }
  return active;
}

/** An order-independent fingerprint of a set of source paths. */
function getSourcesSignature(sourcePaths: string[]): string {
  return JSON.stringify(sourcePaths.slice().sort());
}

/** {@link isMetadataComplete} for a stored row that may be missing. */
function hasCompleteMetadata(
  filePath: string,
  meta: MediaMetadata | undefined,
): boolean {
  return isMetadataComplete(filePath, meta?.status, meta?.duration);
}

/** A usable video duration from a probe result, or null. */
function readDuration(
  result: { duration: number } | { error: string },
): number | null {
  if (
    'duration' in result &&
    Number.isFinite(result.duration) &&
    result.duration > 0
  ) {
    return result.duration;
  }
  return null;
}

/**
 * Collects all file paths from an album tree iteratively.
 * This avoids stack overflow issues with deeply nested directory structures.
 */
function collectAllFilePaths(albums: Album[]): string[] {
  const accumulator: string[] = [];
  const stack: Album[] = albums.slice();

  while (stack.length > 0) {
    const album = stack.pop();
    if (!album) continue;

    for (const texture of album.textures) {
      accumulator.push(texture.path);
    }

    if (album.children && album.children.length > 0) {
      // Push children in reverse order to maintain pre-order traversal
      for (let i = album.children.length - 1; i >= 0; i--) {
        const child = album.children[i];
        if (child) stack.push(child);
      }
    }
  }

  return accumulator;
}

/**
 * Enriches albums to attach stats (view count, duration, rating, playback
 * position, last viewed) iteratively.
 * Mutates the albums array in-place to avoid expensive deep copying
 * of the entire library structure.
 */
function enrichAlbumsWithStats(
  albums: Album[],
  statsMap: Map<string, MediaLibraryItem>,
): Album[] {
  const stack: Album[] = albums.slice();

  while (stack.length > 0) {
    const album = stack.pop();
    if (!album) continue;

    // Mutate textures in-place
    for (const texture of album.textures) {
      const stats = statsMap.get(texture.path);
      // Map SQL nulls to undefined/0 as appropriate
      // Note: stats.rating can be null
      const rating =
        stats?.rating !== undefined && stats.rating !== null
          ? stats.rating
          : texture.rating;

      texture.viewCount = stats?.view_count || 0;
      texture.duration =
        stats?.duration !== undefined && stats.duration !== null
          ? stats.duration
          : undefined;
      texture.rating = rating;

      // Needed by the grid's watched indicator and history ordering.
      const position = stats?.playback_position;
      if (position !== undefined && position !== null) {
        texture.playbackPosition = position;
      }
      if (stats?.last_viewed) {
        const lastViewed = Date.parse(stats.last_viewed);
        if (!Number.isNaN(lastViewed)) {
          texture.lastViewed = lastViewed;
        }
      }
    }

    // Process children
    if (album.children && album.children.length > 0) {
      // Push children in reverse order to maintain pre-order traversal
      for (let i = album.children.length - 1; i >= 0; i--) {
        const child = album.children[i];
        if (child) stack.push(child);
      }
    } else if (!album.children) {
      // Ensure children is always an array (normalization behavior preservation)
      album.children = [];
    }
  }

  return albums;
}

/**
 * Scans active media directories for albums, caches the result in the database,
 * and returns the list of albums found.
 * @returns The list of albums found.
 */
export class MediaService implements IMediaService {
  /**
   * The scan currently running. Callers that want the same source set share
   * it instead of spawning another scan worker.
   */
  private inFlightScan: {
    promise: Promise<Album[]>;
    signature: string;
  } | null = null;

  /** Library files waiting for background metadata extraction. */
  private readonly pendingExtractionPaths = new Set<string>();
  /**
   * Files a client asked to (re-)extract. They are probed even when their
   * stored metadata is already complete (forceCheck).
   */
  private readonly forcedExtractionPaths = new Set<string>();
  private extractionFfmpegPath = '';
  private isExtracting = false;

  constructor(
    private mediaRepo: IMediaRepository,
    private fs: IFileSystem,
    private workerService: IWorkerService,
    private mediaHandler: IMediaHandler,
  ) {}

  private async getGoogleTokens(): Promise<unknown> {
    try {
      const tokenString = await this.mediaRepo.getSetting('google_tokens');
      if (!tokenString) return null;
      const decrypted = decrypt(tokenString);
      if (!decrypted) return null;
      return JSON.parse(decrypted);
    } catch (e) {
      console.warn(
        '[media-service] Failed to fetch google tokens for worker:',
        e,
      );
      return null;
    }
  }

  /**
   * Scans the active sources, caches the album tree and returns it.
   * Concurrent calls for the same source set share one scan. A call made
   * while a scan of an older source set runs waits for it and then scans
   * again, so an outdated scan never has the last word in the cache.
   * @throws If the sources can't be read: a failed read must not be taken
   * for "no sources", which would cache an empty library.
   */
  async scanDiskForAlbumsAndCache(ffmpegPath?: string): Promise<Album[]> {
    const directories = await this.mediaRepo.getMediaDirectories();
    const activePaths = getActiveSourcePaths(directories);
    const signature = getSourcesSignature(activePaths);

    const inFlight = this.inFlightScan;
    if (inFlight) {
      if (inFlight.signature === signature) {
        return inFlight.promise;
      }
      await inFlight.promise.catch(() => undefined);
      return this.scanDiskForAlbumsAndCache(ffmpegPath);
    }

    const promise = this.scanSources(activePaths, signature, ffmpegPath);
    this.inFlightScan = { promise, signature };
    try {
      return await promise;
    } finally {
      if (this.inFlightScan?.promise === promise) {
        this.inFlightScan = null;
      }
    }
  }

  private async scanSources(
    activePaths: string[],
    signature: string,
    ffmpegPath?: string,
  ): Promise<Album[]> {
    let albums: Album[] = [];
    if (activePaths.length > 0) {
      // A source nested in another would be scanned, and listed, twice.
      const roots = collapseNestedSources(activePaths);
      // Only a Drive scan needs the Google credentials.
      const tokens = roots.some(isDrivePath)
        ? await this.getGoogleTokens()
        : null;
      albums =
        (await this.workerService.runScan({ directories: roots, tokens })) ||
        [];
    }

    // Throws when the tree could not be stored: the library membership (the
    // stream whitelist) is written in the same transaction, so every new
    // file would be refused. The scan fails, and the caller keeps its
    // previous library, rather than listing files that cannot play.
    await this.writeAlbumCache(albums);
    await this.stampAlbumCache(signature);

    // Trigger metadata extraction in background if ffmpegPath is provided
    if (ffmpegPath && albums.length > 0) {
      this.queueMetadataExtraction(collectAllFilePaths(albums), ffmpegPath);
    }

    return albums;
  }

  /**
   * Replaces the cached album tree. The source stamp is cleared first and
   * re-written (by the caller) only once the new tree is confirmed stored:
   * a write that fails, times out or never finishes (the app quits) must
   * not leave the old tree behind under a stamp that matches the current
   * sources, or that tree would be served on every launch.
   * @throws If the tree (and with it the library membership) was not
   * stored. The stamp stays cleared, so the next read rescans.
   */
  private async writeAlbumCache(albums: Album[]): Promise<void> {
    try {
      await this.mediaRepo.saveSetting(ALBUM_CACHE_STAMP_KEY, '');
    } catch (e) {
      // The tree is still worth storing; it is only stamped if that works.
      console.warn('[media-service] Failed to clear the album cache stamp:', e);
    }
    try {
      await this.mediaRepo.cacheAlbums(albums);
    } catch (e) {
      console.error(
        '[media-service] Failed to cache albums; the next read rescans:',
        e,
      );
      throw e;
    }
  }

  /** Records which sources the freshly cached album tree came from. */
  private async stampAlbumCache(signature: string): Promise<void> {
    const stamp: AlbumCacheStamp = {
      sources: signature,
      scannedAt: Date.now(),
    };
    try {
      await this.mediaRepo.saveSetting(
        ALBUM_CACHE_STAMP_KEY,
        JSON.stringify(stamp),
      );
    } catch (e) {
      // Without a stamp the next read rescans, which is safe.
      console.warn('[media-service] Failed to stamp the album cache:', e);
    }
  }

  /**
   * Whether a cached album tree can be served: it must have been scanned
   * from the current set of active sources (adding, removing or toggling a
   * source invalidates it), and an empty tree only for a limited time.
   */
  private async isAlbumCacheCurrent(albums: Album[]): Promise<boolean> {
    let directories: MediaDirectory[];
    try {
      directories = await this.mediaRepo.getMediaDirectories();
    } catch (e) {
      // Can't verify the tree; serving it beats failing the request.
      console.warn(
        '[media-service] Failed to read sources, serving cached albums:',
        e,
      );
      return true;
    }

    const stamp = parseAlbumCacheStamp(
      await this.mediaRepo.getSetting(ALBUM_CACHE_STAMP_KEY),
    );
    if (
      !stamp ||
      stamp.sources !== getSourcesSignature(getActiveSourcePaths(directories))
    ) {
      return false;
    }
    return (
      albums.length > 0 ||
      Date.now() - stamp.scannedAt < EMPTY_ALBUM_CACHE_TTL_MS
    );
  }

  /**
   * Queues files for background metadata extraction. One extraction job
   * runs at a time and picks up files queued meanwhile, so overlapping scans
   * and client requests never probe files in parallel and the number of
   * ffmpeg processes stays bounded.
   * This is a fire-and-forget operation.
   * @param options.forceCheck - Probe the files even when their stored
   *   metadata is complete (a client asked for them explicitly). Otherwise
   *   only files that still need it are probed.
   */
  queueMetadataExtraction(
    filePaths: readonly string[],
    ffmpegPath: string,
    options: { forceCheck?: boolean } = {},
  ): void {
    const queue = options.forceCheck
      ? this.forcedExtractionPaths
      : this.pendingExtractionPaths;
    for (const filePath of filePaths) {
      if (filePath) queue.add(filePath);
    }
    this.extractionFfmpegPath = ffmpegPath;
    if (this.isExtracting) return;
    this.isExtracting = true;
    // The drain loop handles its own errors.
    void this.drainMetadataExtraction();
  }

  private async drainMetadataExtraction(): Promise<void> {
    try {
      while (
        this.forcedExtractionPaths.size > 0 ||
        this.pendingExtractionPaths.size > 0
      ) {
        const forced = Array.from(this.forcedExtractionPaths);
        this.forcedExtractionPaths.clear();
        const scanned = Array.from(this.pendingExtractionPaths);
        this.pendingExtractionPaths.clear();
        const ffmpegPath = this.extractionFfmpegPath;

        if (forced.length > 0) {
          await this.runExtractionJob(() =>
            this.extractAndSaveMetadata(forced, ffmpegPath, {
              forceCheck: true,
            }),
          );
        }
        if (scanned.length > 0) {
          await this.runExtractionJob(() =>
            this.extractScannedFiles(scanned, new Set(forced), ffmpegPath),
          );
        }
      }
    } finally {
      this.isExtracting = false;
    }
  }

  /** Runs one extraction job; a failure never stops the drain loop. */
  private async runExtractionJob(job: () => Promise<void>): Promise<void> {
    try {
      await job();
    } catch (e) {
      console.error(
        '[media-service] Background metadata extraction failed:',
        e,
      );
    }
  }

  /**
   * Extracts metadata for scanned files that still need it, plus any
   * library rows left pending. Files just force-extracted are skipped.
   */
  private async extractScannedFiles(
    scannedPaths: string[],
    alreadyExtracted: ReadonlySet<string>,
    ffmpegPath: string,
  ): Promise<void> {
    // Filter paths that are already "success" in DB
    // to avoid fetching ALL metadata or processing known files.
    const pathsToProcess =
      await this.mediaRepo.filterProcessingNeeded(scannedPaths);

    const pending = await this.mediaRepo.getPendingMetadata();
    const uniquePaths = new Set<string>();
    for (const p of [...pending, ...pathsToProcess]) {
      if (!alreadyExtracted.has(p)) uniquePaths.add(p);
    }

    await this.extractAndSaveMetadata(Array.from(uniquePaths), ffmpegPath, {
      forceCheck: false,
    });
  }

  /**
   * Retrieves albums from the cache, rescanning when the cache is missing
   * or no longer matches the configured sources.
   * @returns The list of albums.
   */
  async getAlbumsFromCacheOrDisk(ffmpegPath?: string): Promise<Album[]> {
    const albums = await this.mediaRepo.getCachedAlbums();
    if (albums && (await this.isAlbumCacheCurrent(albums))) {
      return albums;
    }
    return this.scanDiskForAlbumsAndCache(ffmpegPath);
  }

  /**
   * Performs a fresh disk scan and returns the albums with their view counts.
   * This is a utility function to combine scanning and view count retrieval.
   * @returns The list of albums with view counts.
   */
  async getAlbumsWithViewCountsAfterScan(
    ffmpegPath?: string,
  ): Promise<Album[]> {
    const albums = await this.scanDiskForAlbumsAndCache(ffmpegPath);
    return this.withStats(albums);
  }

  /**
   * Retrieves albums (from cache or disk) and augments them with view counts.
   * @returns The list of albums with view counts.
   */
  async getAlbumsWithViewCounts(ffmpegPath?: string): Promise<Album[]> {
    const albums = await this.getAlbumsFromCacheOrDisk(ffmpegPath);
    return this.withStats(albums);
  }

  private async withStats(albums: Album[]): Promise<Album[]> {
    if (!albums || albums.length === 0) {
      return [];
    }

    const items = await this.mediaRepo.getAllMetadataAndStats();
    // Create map for O(1) lookup
    const statsMap = new Map<string, MediaLibraryItem>();
    for (const item of items) {
      if (item.file_path) {
        statsMap.set(item.file_path, item);
      }
    }

    return enrichAlbumsWithStats(albums, statsMap);
  }

  /**
   * Extracts metadata for a list of files and saves it to the database.
   * This is intended to be run in the background.
   */
  async extractAndSaveMetadata(
    filePaths: string[],
    ffmpegPath: string,
    options: { forceCheck?: boolean } = {},
  ): Promise<void> {
    const { forceCheck = false } = options;

    let existingMetadataMap: { [path: string]: MediaMetadata } = {};
    try {
      if (filePaths.length > METADATA_VERIFICATION_THRESHOLD) {
        existingMetadataMap = await this.mediaRepo.getAllMetadataVerification();
      } else if (filePaths.length > 0) {
        existingMetadataMap = await this.mediaRepo.getMetadata(filePaths);
      }
    } catch (e) {
      console.warn(
        '[media-service] Failed to fetch existing metadata for optimization:',
        e,
      );
    }

    const queue = new PQueue({ concurrency: METADATA_EXTRACTION_CONCURRENCY });

    const pendingUpdates: ({ filePath: string } & MediaMetadata)[] = [];

    const flush = async () => {
      if (pendingUpdates.length === 0) return;
      const batch = pendingUpdates.splice(0, pendingUpdates.length);
      try {
        await this.mediaRepo.bulkUpsertMetadata(batch);
      } catch (e) {
        console.error('[media-service] Failed to bulk upsert metadata:', e);
      }
    };

    for (const filePath of filePaths) {
      if (!filePath) {
        continue;
      }

      if (
        !forceCheck &&
        hasCompleteMetadata(filePath, existingMetadataMap[filePath])
      ) {
        continue;
      }

      // Each task handles its own errors, so the returned promise never rejects.
      void queue.add(async () => {
        try {
          const metadata = isDrivePath(filePath)
            ? await this.extractDriveMetadata(filePath)
            : await this.extractLocalMetadata(
                filePath,
                ffmpegPath,
                existingMetadataMap[filePath],
              );
          if (!metadata) return;

          pendingUpdates.push({ filePath, ...metadata });

          if (pendingUpdates.length >= METADATA_BATCH_SIZE) {
            await flush();
          }
        } catch (error) {
          console.warn(
            `[media-service] Error extracting metadata for ${filePath}:`,
            error,
          );
          pendingUpdates.push({ filePath, status: 'failed' });
          if (pendingUpdates.length >= METADATA_BATCH_SIZE) {
            await flush();
          }
        }
      });
    }

    await queue.onIdle();
    await flush();
  }

  /**
   * Reads size, creation time and (for videos) duration of a local file.
   * A video counts as 'success' only once a real duration was read; a failed
   * probe (e.g. a slow share, or a file still being copied) is stored as
   * 'failed' so a later scan retries it.
   * @returns The metadata to store, or null if the stored row is current.
   */
  private async extractLocalMetadata(
    filePath: string,
    ffmpegPath: string,
    existing: MediaMetadata | undefined,
  ): Promise<MediaMetadata | null> {
    const stats = await this.fs.stat(filePath);
    const createdAt = stats.birthtime.toISOString();

    // A video stored as 'success' without a duration (by older versions) is
    // probed again even though the file itself is unchanged.
    if (
      hasCompleteMetadata(filePath, existing) &&
      existing?.size === stats.size &&
      existing.createdAt === createdAt
    ) {
      return null;
    }

    const metadata: MediaMetadata = {
      size: stats.size,
      createdAt,
      status: 'success',
    };

    const ext = path.extname(filePath).toLowerCase();
    if (SUPPORTED_VIDEO_EXTENSIONS_SET.has(ext)) {
      const result = await this.mediaHandler.getVideoDuration(
        filePath,
        ffmpegPath,
      );
      const duration = readDuration(result);
      if (duration === null) {
        console.warn(
          `[media-service] No duration for ${filePath}; will retry on a later scan:`,
          'error' in result ? result.error : result,
        );
        metadata.status = 'failed';
      } else {
        metadata.duration = duration;
      }
    }

    return metadata;
  }

  /**
   * Reads size, creation time and duration of a Google Drive file from the
   * provider's metadata (no download, no ffmpeg). Drive paths carry no
   * extension, so the MIME type decides whether a duration is expected. A
   * video Drive hasn't measured yet is stored as 'failed' and retried later.
   */
  private async extractDriveMetadata(filePath: string): Promise<MediaMetadata> {
    const meta = await this.mediaHandler.getFileMetadata(filePath);
    const metadata: MediaMetadata = { status: 'success' };

    if (Number.isFinite(meta.size) && meta.size > 0) {
      metadata.size = meta.size;
    }
    if (meta.lastModified && !Number.isNaN(meta.lastModified.getTime())) {
      metadata.createdAt = meta.lastModified.toISOString();
    }
    if (meta.mimeType.startsWith('video/')) {
      if (
        meta.duration !== undefined &&
        Number.isFinite(meta.duration) &&
        meta.duration > 0
      ) {
        metadata.duration = meta.duration;
      } else {
        metadata.status = 'failed';
      }
    }
    return metadata;
  }
}
