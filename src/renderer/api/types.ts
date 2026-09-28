import type {
  Album,
  MediaDirectory,
  SmartPlaylist,
  MediaMetadata,
  MediaLibraryItem,
  HeatmapData,
  TranscodeJob,
} from '../../core/media/types';
import type { FileSystemEntry } from '../../core/media/file-system';
import type {
  DriveCacheProgressEvent,
  DriveCacheStatus,
} from '../../shared/ipc/media.contract';

export interface LoadResult {
  type: 'data-url' | 'http-url' | 'error';
  url?: string;
  message?: string;
}

export interface AuthStatus {
  enabled: boolean;
  isAuthenticated: boolean;
}

export interface IMediaBackend {
  // Global Password Lock
  getLockStatus(): Promise<AuthStatus>;
  unlock(password: string): Promise<boolean>;

  loadFileAsDataURL(filePath: string): Promise<LoadResult>;
  recordMediaView(filePath: string): Promise<void>;
  getMediaViewCounts(
    filePaths: string[],
  ): Promise<{ [filePath: string]: number }>;
  getAlbumsWithViewCounts(): Promise<Album[]>;
  reindexMediaLibrary(): Promise<Album[]>;
  addMediaDirectory(path?: string): Promise<string | null>; // Electron only (opens dialog)
  removeMediaDirectory(directoryPath: string): Promise<void>;
  setDirectoryActiveState(
    directoryPath: string,
    isActive: boolean,
  ): Promise<void>;
  getMediaDirectories(): Promise<MediaDirectory[]>;
  getSupportedExtensions(): Promise<{
    images: string[];
    videos: string[];
    all: string[];
  }>;
  getServerPort(): Promise<number>;
  getMediaUrlGenerator(): Promise<(filePath: string) => string>;
  getThumbnailUrlGenerator(): Promise<(filePath: string) => string>;
  getVideoStreamUrlGenerator(): Promise<
    (filePath: string, startTime?: number) => string
  >;
  getHlsUrl(filePath: string): Promise<string>;
  getHlsStatus(
    filePath: string,
  ): Promise<{ currentTime: number; duration: number; percent: number } | null>;
  getVideoMetadata(filePath: string): Promise<{ duration: number }>;
  /**
   * Aborting `options.signal` rejects the call and tells the backend this
   * viewer no longer needs the analysis.
   */
  getHeatmap(
    filePath: string,
    points?: number,
    options?: { signal?: AbortSignal },
  ): Promise<HeatmapData>;
  getHeatmapProgress(filePath: string): Promise<number | null>; // Returns 0-100 or null if no job
  openInVlc(filePath: string): Promise<{ success: boolean; message?: string }>;

  listDirectory(path: string): Promise<FileSystemEntry[]>;

  getParentDirectory(path: string): Promise<string | null>;

  // Smart Playlists & Metadata
  upsertMetadata(filePath: string, metadata: MediaMetadata): Promise<void>;
  getMetadata(filePaths: string[]): Promise<{ [path: string]: MediaMetadata }>;
  setRating(filePath: string, rating: number): Promise<void>;
  createSmartPlaylist(name: string, criteria: string): Promise<{ id: number }>;
  getSmartPlaylists(): Promise<SmartPlaylist[]>;
  deleteSmartPlaylist(id: number): Promise<void>;
  updateSmartPlaylist(
    id: number,
    name: string,
    criteria: string,
  ): Promise<void>;
  updateWatchedSegments(filePath: string, segmentsJson: string): Promise<void>;
  updatePlaybackPosition(filePath: string, position: number): Promise<void>;

  executeSmartPlaylist(criteria: string): Promise<MediaLibraryItem[]>;

  getAllMetadataAndStats(): Promise<MediaLibraryItem[]>;
  getRecentlyPlayed(limit?: number): Promise<MediaLibraryItem[]>;
  extractMetadata(filePaths: string[]): Promise<void>;

  // Transcode Jobs
  addTranscodeJobs(paths: string[]): Promise<void>;
  listTranscodeJobs(): Promise<TranscodeJob[]>;
  cancelTranscodeJob(path: string): Promise<void>;

  // Google Drive
  checkGoogleDriveAuth(): Promise<boolean>;
  startGoogleDriveAuth(): Promise<string>;
  submitGoogleDriveAuthCode(code: string): Promise<boolean>;
  addGoogleDriveSource(folderId: string): Promise<{ name?: string }>;
  listGoogleDriveDirectory(folderId: string): Promise<FileSystemEntry[]>;
  getGoogleDriveParent(folderId: string): Promise<string | null>;

  // Google Drive offline cache. Only the desktop app keeps one; the web
  // adapter reports it unsupported so the UI can hide the controls.
  readonly supportsDriveOfflineCache: boolean;
  getDriveCacheStatus(fileId: string): Promise<DriveCacheStatus>;
  /** Resolves once the download runs; rejects with the reason it can't. */
  triggerDriveCache(fileId: string): Promise<void>;
  /** Subscribes to cache events for one Drive file; returns the unsubscriber. */
  onDriveCacheProgress(
    fileId: string,
    callback: (event: DriveCacheProgressEvent) => void,
  ): () => void;
}
