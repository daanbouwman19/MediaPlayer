import { IMediaBackend, LoadResult, AuthStatus } from './types';
import { HttpError } from './http-error';
import type {
  Album,
  MediaDirectory,
  SmartPlaylist,
  MediaMetadata,
  MediaLibraryItem,
  IpcResult,
  HeatmapData,
  TranscodeJob,
} from '../../core/media/types';
import type { FileSystemEntry } from '../../core/media/file-system';
import type {
  DriveCacheProgressEvent,
  DriveCacheStatus,
} from '../../shared/ipc/media.contract';

type DriveCacheListener = (event: DriveCacheProgressEvent) => void;

/**
 * URL cache with LRU eviction: hits refresh recency, overflow evicts only
 * the oldest entry (a full clear would thrash for large libraries).
 */
function createLruUrlCache(maxSize: number) {
  const cache = new Map<string, string>();
  return {
    get(key: string): string | undefined {
      const value = cache.get(key);
      if (value !== undefined) {
        cache.delete(key);
        cache.set(key, value);
      }
      return value;
    },
    set(key: string, value: string): void {
      if (cache.size >= maxSize) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
          cache.delete(oldest);
        }
      }
      cache.set(key, value);
    },
  };
}

const URL_CACHE_MAX_SIZE = 10000;

export class ElectronAdapter implements IMediaBackend {
  readonly supportsDriveOfflineCache = true;

  // One bridge subscription fans cache events out to the tiles showing that
  // file, instead of every Drive tile filtering every event itself.
  private readonly driveCacheListeners = new Map<
    string,
    Set<DriveCacheListener>
  >();
  private unsubscribeDriveCacheBridge: (() => void) | null = null;

  constructor(private bridge = window.electronAPI) {}

  private async invoke<T>(promise: Promise<IpcResult<T>>): Promise<T> {
    const result = await promise;
    if (result.success) {
      return result.data;
    }
    throw new Error(result.error);
  }

  // Optional PIN lock, kept by the main process.
  readonly supportsLocalPin = true;

  async getLockStatus(): Promise<AuthStatus> {
    return this.invoke(this.bridge.getLockStatus());
  }

  async unlock(pin: string): Promise<boolean> {
    const result = await this.invoke(this.bridge.unlock(pin));
    if (result === 'rateLimited') {
      // Same signal the web backend gives, so the lock screen treats both
      // modes alike.
      throw new HttpError(429, 'Too many attempts');
    }
    return result === 'ok';
  }

  async lock(): Promise<void> {
    return this.invoke(this.bridge.lock());
  }

  async setPin(pin: string): Promise<void> {
    return this.invoke(this.bridge.setPin(pin));
  }

  async clearPin(): Promise<void> {
    return this.invoke(this.bridge.clearPin());
  }

  minimizeWindow(): void {
    this.bridge.minimizeWindow();
  }

  onLockRequest(callback: () => void): () => void {
    return this.bridge.onLockRequest(callback);
  }

  async loadFileAsDataURL(filePath: string): Promise<LoadResult> {
    return this.invoke(this.bridge.loadFileAsDataURL(filePath));
  }

  async recordMediaView(filePath: string): Promise<void> {
    return this.invoke(this.bridge.recordMediaView(filePath));
  }

  async getMediaViewCounts(
    filePaths: string[],
  ): Promise<{ [filePath: string]: number }> {
    return this.invoke(this.bridge.getMediaViewCounts(filePaths));
  }

  async getAlbumsWithViewCounts(): Promise<Album[]> {
    return this.invoke(this.bridge.getAlbumsWithViewCounts());
  }

  async reindexMediaLibrary(): Promise<Album[]> {
    return this.invoke(this.bridge.reindexMediaLibrary());
  }

  async addMediaDirectory(path?: string): Promise<string | null> {
    return this.invoke(this.bridge.addMediaDirectory(path));
  }

  async removeMediaDirectory(directoryPath: string): Promise<void> {
    return this.invoke(this.bridge.removeMediaDirectory(directoryPath));
  }

  async setDirectoryActiveState(
    directoryPath: string,
    isActive: boolean,
  ): Promise<void> {
    return this.invoke(
      this.bridge.setDirectoryActiveState(directoryPath, isActive),
    );
  }

  async getMediaDirectories(): Promise<MediaDirectory[]> {
    return this.invoke(this.bridge.getMediaDirectories());
  }

  async getSupportedExtensions(): Promise<{
    images: string[];
    videos: string[];
    all: string[];
  }> {
    return this.invoke(this.bridge.getSupportedExtensions());
  }

  async getServerPort(): Promise<number> {
    return this.invoke(this.bridge.getServerPort());
  }

  async getMediaUrlGenerator(): Promise<(filePath: string) => string> {
    const port = await this.invoke(this.bridge.getServerPort());
    const cache = createLruUrlCache(URL_CACHE_MAX_SIZE);

    return (filePath: string) => {
      const cached = cache.get(filePath);
      if (cached !== undefined) {
        return cached;
      }

      let url: string;
      if (filePath.startsWith('gdrive://')) {
        url = `http://localhost:${port}/${encodeURIComponent(filePath)}`;
      } else {
        // Standardize path separators and encode segments
        let pathForUrl = filePath.replace(/\\/g, '/');
        pathForUrl = pathForUrl
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        url = `http://localhost:${port}/${pathForUrl}`;
      }

      cache.set(filePath, url);
      return url;
    };
  }

  async getThumbnailUrlGenerator(): Promise<(filePath: string) => string> {
    const port = await this.invoke(this.bridge.getServerPort());
    const cache = createLruUrlCache(URL_CACHE_MAX_SIZE);

    return (filePath: string) => {
      const cached = cache.get(filePath);
      if (cached !== undefined) {
        return cached;
      }

      const url = `http://localhost:${port}/video/thumbnail?file=${encodeURIComponent(filePath)}`;

      cache.set(filePath, url);
      return url;
    };
  }

  async getVideoStreamUrlGenerator(): Promise<
    (filePath: string, startTime?: number) => string
  > {
    const port = await this.invoke(this.bridge.getServerPort());
    return (filePath: string, startTime = 0) => {
      return `http://localhost:${port}/video/stream?file=${encodeURIComponent(filePath)}&startTime=${startTime}`;
    };
  }

  async getHlsUrl(filePath: string): Promise<string> {
    const port = await this.invoke(this.bridge.getServerPort());
    return `http://localhost:${port}/api/hls/master.m3u8?file=${encodeURIComponent(filePath)}`;
  }

  async getHlsStatus(filePath: string): Promise<{
    currentTime: number;
    duration: number;
    percent: number;
  } | null> {
    return this.invoke(this.bridge.getHlsStatus(filePath));
  }

  async getVideoMetadata(filePath: string): Promise<{ duration: number }> {
    const res = await this.invoke(this.bridge.getVideoMetadata(filePath));
    if (res.error || res.duration === undefined) {
      throw new Error(res.error || 'Failed to get video metadata');
    }
    return { duration: res.duration };
  }

  async getHeatmap(
    filePath: string,
    points?: number,
    options: { signal?: AbortSignal } = {},
  ): Promise<HeatmapData> {
    const { signal } = options;
    signal?.throwIfAborted();
    const request = this.invoke(this.bridge.getHeatmap(filePath, points));
    if (!signal) return request;

    // An IPC call cannot be aborted, so tell the main process this window
    // no longer needs the analysis and stop waiting for it.
    let onAbort = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        this.bridge.cancelHeatmap(filePath).catch(() => {});
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([request, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
      // The abandoned request may still settle; nobody is waiting for it.
      request.catch(() => {});
    }
  }

  async getHeatmapProgress(filePath: string): Promise<number | null> {
    return this.invoke(this.bridge.getHeatmapProgress(filePath));
  }

  async openInVlc(
    filePath: string,
  ): Promise<{ success: boolean; message?: string }> {
    return this.invoke(this.bridge.openInVlc(filePath));
  }

  async listDirectory(path: string): Promise<FileSystemEntry[]> {
    return this.invoke(this.bridge.listDirectory(path));
  }

  async getParentDirectory(path: string): Promise<string | null> {
    return this.invoke(this.bridge.getParentDirectory(path));
  }

  async upsertMetadata(
    filePath: string,
    metadata: MediaMetadata,
  ): Promise<void> {
    return this.invoke(this.bridge.upsertMetadata(filePath, metadata));
  }

  async getMetadata(
    filePaths: string[],
  ): Promise<{ [path: string]: MediaMetadata }> {
    return this.invoke(this.bridge.getMetadata(filePaths));
  }

  async setRating(filePath: string, rating: number): Promise<void> {
    return this.invoke(this.bridge.setRating(filePath, rating));
  }

  async createSmartPlaylist(
    name: string,
    criteria: string,
  ): Promise<{ id: number }> {
    return this.invoke(this.bridge.createSmartPlaylist(name, criteria));
  }

  async getSmartPlaylists(): Promise<SmartPlaylist[]> {
    return this.invoke(this.bridge.getSmartPlaylists());
  }

  async deleteSmartPlaylist(id: number): Promise<void> {
    return this.invoke(this.bridge.deleteSmartPlaylist(id));
  }

  async updateSmartPlaylist(
    id: number,
    name: string,
    criteria: string,
  ): Promise<void> {
    return this.invoke(this.bridge.updateSmartPlaylist(id, name, criteria));
  }
  async updateWatchedSegments(
    filePath: string,
    segmentsJson: string,
  ): Promise<void> {
    return this.invoke(
      this.bridge.updateWatchedSegments(filePath, segmentsJson),
    );
  }

  async updatePlaybackPosition(
    filePath: string,
    position: number,
  ): Promise<void> {
    return this.invoke(this.bridge.updatePlaybackPosition(filePath, position));
  }

  async executeSmartPlaylist(criteria: string): Promise<MediaLibraryItem[]> {
    return this.invoke(this.bridge.executeSmartPlaylist(criteria));
  }

  async getAllMetadataAndStats(): Promise<MediaLibraryItem[]> {
    return this.invoke(this.bridge.getAllMetadataAndStats());
  }

  async getRecentlyPlayed(limit?: number): Promise<MediaLibraryItem[]> {
    return this.invoke(this.bridge.getRecentlyPlayed(limit));
  }

  async extractMetadata(filePaths: string[]): Promise<void> {
    return this.invoke(this.bridge.extractMetadata(filePaths));
  }

  async checkGoogleDriveAuth(): Promise<boolean> {
    return this.invoke(this.bridge.checkGoogleDriveAuth());
  }

  async startGoogleDriveAuth(): Promise<string> {
    const url = await this.invoke(this.bridge.startGoogleDriveAuth());
    await this.invoke(this.bridge.openExternal(url));
    return url;
  }

  async submitGoogleDriveAuthCode(code: string): Promise<boolean> {
    return this.invoke(this.bridge.submitGoogleDriveAuthCode(code));
  }

  async addGoogleDriveSource(folderId: string): Promise<{ name?: string }> {
    return this.invoke(this.bridge.addGoogleDriveSource(folderId));
  }

  async listGoogleDriveDirectory(folderId: string): Promise<FileSystemEntry[]> {
    return this.invoke(this.bridge.listGoogleDriveDirectory(folderId));
  }

  async getGoogleDriveParent(folderId: string): Promise<string | null> {
    return this.invoke(this.bridge.getGoogleDriveParent(folderId));
  }

  async getDriveCacheStatus(fileId: string): Promise<DriveCacheStatus> {
    return this.invoke(this.bridge.getDriveCacheStatus(fileId));
  }

  async triggerDriveCache(fileId: string): Promise<void> {
    return this.invoke(this.bridge.triggerDriveCache(fileId));
  }

  onDriveCacheProgress(
    fileId: string,
    callback: DriveCacheListener,
  ): () => void {
    let listeners = this.driveCacheListeners.get(fileId);
    if (!listeners) {
      listeners = new Set();
      this.driveCacheListeners.set(fileId, listeners);
    }
    listeners.add(callback);

    if (!this.unsubscribeDriveCacheBridge) {
      this.unsubscribeDriveCacheBridge = this.bridge.onDriveCacheProgress(
        (_event, data) => {
          const targets = this.driveCacheListeners.get(data.fileId);
          if (!targets) return;
          for (const listener of Array.from(targets)) {
            listener(data);
          }
        },
      );
    }

    return () => {
      const current = this.driveCacheListeners.get(fileId);
      if (!current || !current.delete(callback)) return;
      if (current.size === 0) {
        this.driveCacheListeners.delete(fileId);
      }
      if (this.driveCacheListeners.size === 0) {
        this.unsubscribeDriveCacheBridge?.();
        this.unsubscribeDriveCacheBridge = null;
      }
    };
  }

  async addTranscodeJobs(paths: string[]): Promise<void> {
    return this.invoke(this.bridge.addTranscodeJobs(paths));
  }

  async listTranscodeJobs(): Promise<TranscodeJob[]> {
    return this.invoke(this.bridge.listTranscodeJobs());
  }

  async cancelTranscodeJob(path: string): Promise<void> {
    return this.invoke(this.bridge.cancelTranscodeJob(path));
  }
}
