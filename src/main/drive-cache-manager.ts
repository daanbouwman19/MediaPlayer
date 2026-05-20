import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import {
  getDriveFileStream,
  getDriveFileMetadata,
} from './google-drive-service.ts';

class DriveCacheManager extends EventEmitter {
  private cacheDir: string;
  private activeDownloads: Map<string, Promise<string>>;
  private metadataCache: Map<string, { size: number; mimeType: string }>;
  private accessOrder: Map<string, number>;
  private evictionRunning = false;
  private readonly MAX_CACHE_BYTES = 5 * 1024 ** 3; // 5 GB

  constructor(cacheDir: string) {
    super();
    this.cacheDir = cacheDir;
    this.activeDownloads = new Map();
    this.metadataCache = new Map();
    this.accessOrder = new Map();
    this.ensureCacheDir();
  }

  private ensureCacheDir() {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  public async getCachedFilePath(
    fileId: string,
  ): Promise<{ path: string; totalSize: number; mimeType: string }> {
    if (
      !fileId ||
      typeof fileId !== 'string' ||
      fileId.includes('..') ||
      fileId.includes('/') ||
      fileId.includes('\\') ||
      fileId.includes('\0')
    ) {
      throw new Error('Invalid fileId');
    }
    const filePath = path.join(this.cacheDir, fileId);

    // Get metadata (cached or fresh) to return correct total size
    let metadata = this.metadataCache.get(fileId);
    if (!metadata) {
      try {
        const meta = await getDriveFileMetadata(fileId);
        metadata = {
          size: Number(meta.size),
          mimeType: meta.mimeType || 'video/mp4',
        };
        this.metadataCache.set(fileId, metadata);
      } catch (error) {
        console.error('[DriveCache] Failed to fetch metadata:', error);
        metadata = { size: 0, mimeType: 'video/mp4' }; // Fallback
      }
    }

    this.accessOrder.set(fileId, Date.now());

    let stats: fs.Stats | null = null;
    try {
      stats = await fsPromises.stat(filePath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== 'ENOENT') {
        console.error(
          '[DriveCache] Failed to stat cache file for %s:',
          fileId,
          error,
        );
      }
    }

    if (stats) {
      // Register the resume promise in activeDownloads to prevent concurrent resume races
      if (!this.activeDownloads.has(fileId) && stats.size < metadata.size) {
        const resumePromise = this.startDownload(fileId, filePath, stats.size);
        this.activeDownloads.set(fileId, resumePromise);
        resumePromise.catch((err) => {
          this.activeDownloads.delete(fileId);
          console.error('[DriveCache] Download failed:', fileId, err);
        });
      }

      return {
        path: filePath,
        totalSize: metadata.size,
        mimeType: metadata.mimeType,
      };
    }

    // New download
    if (!this.activeDownloads.has(fileId)) {
      const downloadPromise = this.startDownload(fileId, filePath, 0);
      this.activeDownloads.set(fileId, downloadPromise);
      try {
        await downloadPromise;
      } catch (e) {
        console.error('[DriveCache] Failed to start download:', fileId, e);
        throw e;
      }
    } else {
      // If already downloading, wait for it to be ready (if not already)
      try {
        await this.activeDownloads.get(fileId);
      } catch (e) {
        console.warn(
          '[DriveCache] Existing download errored, trying to proceed anyway:',
          fileId,
          e,
        );
      }
    }

    return {
      path: filePath,
      totalSize: metadata.size,
      mimeType: metadata.mimeType,
    };
  }

  public async getCacheStatus(
    fileId: string,
  ): Promise<{ status: 'ready' | 'syncing' | 'cloud'; progress: number }> {
    if (fileId === '') {
      return { status: 'cloud', progress: 0 };
    }
    if (
      !fileId ||
      typeof fileId !== 'string' ||
      fileId.includes('..') ||
      fileId.includes('/') ||
      fileId.includes('\\') ||
      fileId.includes('\0')
    ) {
      throw new Error('Invalid fileId');
    }
    const filePath = path.join(this.cacheDir, fileId);

    const isDownloading = this.activeDownloads.has(fileId);

    let stats: fs.Stats | null = null;
    try {
      stats = await fsPromises.stat(filePath);
    } catch {
      return { status: 'cloud', progress: 0 };
    }

    let metadata = this.metadataCache.get(fileId);
    if (!metadata) {
      try {
        const meta = await getDriveFileMetadata(fileId);
        metadata = {
          size: Number(meta.size),
          mimeType: meta.mimeType || 'video/mp4',
        };
        this.metadataCache.set(fileId, metadata);
      } catch {
        return {
          status: isDownloading ? 'syncing' : 'ready',
          progress: isDownloading ? 0.5 : 1,
        };
      }
    }

    if (metadata.size === 0) {
      return { status: 'ready', progress: 1 };
    }

    const progress = Math.min(1, stats.size / metadata.size);

    if (isDownloading) {
      return { status: 'syncing', progress };
    }

    if (stats.size >= metadata.size) {
      return { status: 'ready', progress: 1 };
    }

    return { status: 'cloud', progress };
  }

  public async triggerDownload(fileId: string): Promise<void> {
    await this.getCachedFilePath(fileId);
  }

  private async startDownload(
    fileId: string,
    filePath: string,
    startByte: number,
  ): Promise<string> {
    const flags = startByte > 0 ? 'a' : 'w';

    const stream = await getDriveFileStream(fileId, { start: startByte });
    const fileStream = fs.createWriteStream(filePath, { flags });

    let downloadedBytes = startByte;
    const metadata = this.metadataCache.get(fileId);
    const total = metadata ? metadata.size : 0;

    stream.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const progress = total > 0 ? downloadedBytes / total : 0;
      this.emit('progress', {
        fileId,
        downloadedBytes,
        totalSize: total,
        progress,
      });
    });

    stream.pipe(fileStream);

    return new Promise((resolve, reject) => {
      fileStream.on('ready', () => {
        resolve(filePath);
      });

      fileStream.on('error', (err) => {
        console.error('[DriveCache] File write error for %s:', fileId, err);
        this.activeDownloads.delete(fileId);
        reject(err);
      });

      stream.on('error', (err) => {
        console.error('[DriveCache] Drive Stream error for %s:', fileId, err);
        fileStream.close();
        this.activeDownloads.delete(fileId);
        // Delete the partial/corrupt file so the next request triggers a fresh download
        fsPromises.unlink(filePath).catch((unlinkErr) => {
          if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error(
              '[DriveCache] Failed to delete corrupt file %s:',
              fileId,
              unlinkErr,
            );
          }
        });
        this.metadataCache.delete(fileId);
        this.accessOrder.delete(fileId);
      });

      fileStream.on('finish', () => {
        this.activeDownloads.delete(fileId);
        void this.enforceEviction();
      });
    });
  }

  private async enforceEviction(): Promise<void> {
    // Guard: skip if an eviction pass is already in progress. The next
    // completed download will trigger another check.
    if (this.evictionRunning) return;
    this.evictionRunning = true;
    try {
      let entries: string[];
      try {
        entries = await fsPromises.readdir(this.cacheDir);
      } catch {
        return;
      }

      // Stat all entries in parallel instead of sequentially
      const results = await Promise.all(
        entries.map(async (entry) => {
          try {
            const stat = await fsPromises.stat(path.join(this.cacheDir, entry));
            return {
              fileId: entry,
              size: stat.size,
              lastAccess: this.accessOrder.get(entry) ?? stat.mtimeMs,
            };
          } catch {
            return null;
          }
        }),
      );

      const fileInfos = results.filter(
        (r): r is { fileId: string; size: number; lastAccess: number } =>
          r !== null,
      );
      let totalSize = fileInfos.reduce((sum, f) => sum + f.size, 0);

      if (totalSize <= this.MAX_CACHE_BYTES) return;

      fileInfos.sort((a, b) => a.lastAccess - b.lastAccess);

      for (const { fileId, size } of fileInfos) {
        if (totalSize <= this.MAX_CACHE_BYTES) break;
        if (this.activeDownloads.has(fileId)) continue;

        try {
          await fsPromises.unlink(path.join(this.cacheDir, fileId));
          this.metadataCache.delete(fileId);
          this.accessOrder.delete(fileId);
          totalSize -= size;
          console.log('[DriveCache] Evicted %s (%d bytes)', fileId, size);
        } catch (err) {
          console.error('[DriveCache] Failed to evict %s:', fileId, err);
        }
      }
    } finally {
      this.evictionRunning = false;
    }
  }

  public async invalidateFile(fileId: string): Promise<void> {
    this.metadataCache.delete(fileId);
    this.accessOrder.delete(fileId);
    const filePath = path.join(this.cacheDir, fileId);
    try {
      await fsPromises.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[DriveCache] Failed to invalidate %s:', fileId, err);
      }
    }
  }

  public cleanup() {
    try {
      fs.rmSync(this.cacheDir, { recursive: true, force: true });
      console.log('[DriveCache] Cache cleared.');
    } catch (e) {
      console.error('[DriveCache] Cleanup failed:', e);
    }
  }
}

let driveCacheManagerInstance: DriveCacheManager | null = null;

export const initializeDriveCacheManager = (cacheDir: string) => {
  if (!driveCacheManagerInstance) {
    driveCacheManagerInstance = new DriveCacheManager(cacheDir);
  }
  return driveCacheManagerInstance;
};

export const getDriveCacheManager = () => {
  if (!driveCacheManagerInstance) {
    throw new Error('DriveCacheManager has not been initialized.');
  }
  return driveCacheManagerInstance;
};

export const cleanupDriveCacheManager = () => {
  if (!driveCacheManagerInstance) {
    return;
  }
  driveCacheManagerInstance.cleanup();
  driveCacheManagerInstance = null;
};
