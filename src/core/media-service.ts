/**
 * @file Shared media service logic.
 * Orchestrates scanning, caching, and view count retrieval.
 */

import { MediaRepository } from './repositories/media-repository.ts';
import { WorkerClient } from './worker-client.ts';
import path from 'path';
import { fileURLToPath } from 'url';
import { getVideoDuration } from './media-handler.ts';
import { WorkerFactory } from './worker-factory.ts';
import type { Album, MediaMetadata } from './types.ts';
import fs from 'fs/promises';
import PQueue from 'p-queue';
import {
  METADATA_EXTRACTION_CONCURRENCY,
  METADATA_BATCH_SIZE,
  METADATA_VERIFICATION_THRESHOLD,
  SUPPORTED_VIDEO_EXTENSIONS_SET,
  WORKER_SCAN_TIMEOUT_MS,
} from './constants.ts';
import { isDrivePath } from './media-utils.ts';
import type { MediaLibraryItem } from './types.ts';
import { decrypt } from './utils/encryption.ts';

/**
 * Collects all file paths from an album tree iteratively.
 * This avoids stack overflow issues with deeply nested directory structures.
 */
function collectAllFilePaths(albums: Album[]): string[] {
  const accumulator: string[] = [];
  const stack: Album[] = [...albums];

  while (stack.length > 0) {
    const album = stack.pop();
    if (!album) continue;

    for (const texture of album.textures) {
      accumulator.push(texture.path);
    }

    if (album.children && album.children.length > 0) {
      // Push children in reverse order to maintain pre-order traversal
      for (let i = album.children.length - 1; i >= 0; i--) {
        stack.push(album.children[i]);
      }
    }
  }

  return accumulator;
}

/**
 * Enriches albums to attach stats (view count, duration, rating) iteratively.
 * Bolt Optimization: Mutates the albums array in-place to avoid expensive deep copying
 * of the entire library structure.
 */
function enrichAlbumsWithStats(
  albums: Album[],
  statsMap: Map<string, MediaLibraryItem>,
): Album[] {
  const stack: Album[] = [...albums];

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
    }

    // Process children
    if (album.children && album.children.length > 0) {
      // Push children in reverse order to maintain pre-order traversal
      for (let i = album.children.length - 1; i >= 0; i--) {
        stack.push(album.children[i]);
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
export class MediaService {
  constructor(private mediaRepo: MediaRepository) {}

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

  private async getCachedPaths(): Promise<string[]> {
    try {
      const cachedAlbums = await this.mediaRepo.getCachedAlbums();
      return cachedAlbums ? collectAllFilePaths(cachedAlbums) : [];
    } catch (e) {
      console.warn(
        '[media-service] Failed to fetch cached albums for diffing:',
        e,
      );
      return [];
    }
  }

  async scanDiskForAlbumsAndCache(ffmpegPath?: string): Promise<Album[]> {
    const allDirectories = await this.mediaRepo.getMediaDirectories();
    const activeDirectories = allDirectories
      .filter((dir) => dir.isActive)
      .map((dir) => dir.path);

    if (!activeDirectories || activeDirectories.length === 0) {
      await this.mediaRepo.cacheAlbums([]);
      return [];
    }

    // Determine worker path using centralized factory
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const isElectron = !!process.versions['electron'];

    const { path: workerPath, options: workerOptions } =
      await WorkerFactory.getWorkerPath('scan-worker', {
        isElectron,
        currentDirname: __dirname,
        currentUrl: import.meta.url,
      });

    // Run scan in a worker
    const albums = await new Promise<Album[]>(async (resolve, reject) => {
      const client = new WorkerClient(workerPath, {
        workerOptions,
        operationTimeout: WORKER_SCAN_TIMEOUT_MS,
        name: 'scan-worker',
      });

      try {
        const tokens = await this.getGoogleTokens();
        const previousPaths = await this.getCachedPaths();

        await client.init();

        const result = await client.sendMessage<Album[]>('START_SCAN', {
          directories: activeDirectories,
          tokens,
          previousPaths,
        });

        resolve(result);
      } catch (err) {
        reject(err);
      } finally {
        await client.terminate();
      }
    });

    await this.mediaRepo.cacheAlbums(albums || []);

    // Trigger metadata extraction in background if ffmpegPath is provided
    if (ffmpegPath && albums && albums.length > 0) {
      this.triggerBackgroundMetadataExtraction(albums, ffmpegPath);
    }

    return albums || [];
  }

  /**
   * Triggers the metadata extraction process in the background.
   * This is a fire-and-forget operation.
   */
  private triggerBackgroundMetadataExtraction(
    albums: Album[],
    ffmpegPath: string,
  ): void {
    const allFilePaths = collectAllFilePaths(albums);

    (async () => {
      try {
        // Bolt Optimization: Filter paths that are already "success" in DB
        // to avoid fetching ALL metadata or processing known files.
        const pathsToProcess =
          await this.mediaRepo.filterProcessingNeeded(allFilePaths);

        const pending = await this.mediaRepo.getPendingMetadata();
        const uniquePaths = new Set(pending);
        for (const p of pathsToProcess) {
          uniquePaths.add(p);
        }

        await this.extractAndSaveMetadata(Array.from(uniquePaths), ffmpegPath, {
          forceCheck: false,
        });
      } catch (e) {
        console.error(
          '[media-service] Background metadata extraction failed:',
          e,
        );
      }
    })();
  }

  /**
   * Retrieves albums by first checking the cache, and if the cache is empty,
   * performs a disk scan.
   * @returns The list of albums.
   */
  async getAlbumsFromCacheOrDisk(ffmpegPath?: string): Promise<Album[]> {
    const albums = await this.mediaRepo.getCachedAlbums();
    if (albums && albums.length > 0) {
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
    if (!albums || albums.length === 0) {
      return [];
    }

    const items = await this.mediaRepo.getAllMetadataAndStats();
    // Bolt Optimization: Create map for O(1) lookup
    const statsMap = new Map<string, MediaLibraryItem>();
    for (const item of items) {
      if (item.file_path) {
        statsMap.set(item.file_path, item);
      }
    }

    return enrichAlbumsWithStats(albums, statsMap);
  }

  /**
   * Retrieves albums (from cache or disk) and augments them with view counts.
   * @returns The list of albums with view counts.
   */
  async getAlbumsWithViewCounts(ffmpegPath?: string): Promise<Album[]> {
    const albums = await this.getAlbumsFromCacheOrDisk(ffmpegPath);
    if (!albums || albums.length === 0) {
      return [];
    }

    const items = await this.mediaRepo.getAllMetadataAndStats();
    // Bolt Optimization: Create map for O(1) lookup
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

      if (!forceCheck && existingMetadataMap[filePath]?.status === 'success') {
        continue;
      }

      queue.add(async () => {
        try {
          if (isDrivePath(filePath)) {
            return;
          }

          const stats = await fs.stat(filePath);

          const existing = existingMetadataMap[filePath];
          if (
            existing &&
            existing.status === 'success' &&
            existing.size === stats.size &&
            existing.createdAt === stats.birthtime.toISOString()
          ) {
            return;
          }

          const metadata: MediaMetadata = {
            size: stats.size,
            createdAt: stats.birthtime.toISOString(),
            status: 'processing',
          };

          const ext = path.extname(filePath).toLowerCase();
          if (SUPPORTED_VIDEO_EXTENSIONS_SET.has(ext)) {
            const result = await getVideoDuration(filePath, ffmpegPath);
            if (result && 'duration' in result) {
              metadata.duration = result.duration;
            }
          }

          metadata.status = 'success';

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
}

const defaultMediaService = new MediaService(new MediaRepository());

export async function scanDiskForAlbumsAndCache(ffmpegPath?: string) {
  return defaultMediaService.scanDiskForAlbumsAndCache(ffmpegPath);
}

export async function getAlbumsFromCacheOrDisk(ffmpegPath?: string) {
  return defaultMediaService.getAlbumsFromCacheOrDisk(ffmpegPath);
}

export async function getAlbumsWithViewCountsAfterScan(ffmpegPath?: string) {
  return defaultMediaService.getAlbumsWithViewCountsAfterScan(ffmpegPath);
}

export async function getAlbumsWithViewCounts(ffmpegPath?: string) {
  return defaultMediaService.getAlbumsWithViewCounts(ffmpegPath);
}

export async function extractAndSaveMetadata(
  filePaths: string[],
  ffmpegPath: string,
  options: { forceCheck?: boolean } = {},
) {
  return defaultMediaService.extractAndSaveMetadata(
    filePaths,
    ffmpegPath,
    options,
  );
}
