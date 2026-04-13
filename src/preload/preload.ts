/**
 * @file Preload script for Electron's renderer process.
 * This script runs in a privileged environment before the renderer's web page is loaded.
 * It uses the `contextBridge` to securely expose a limited and controlled API
 * from the main process to the renderer process. This is essential for maintaining
 * process isolation and security in the Electron application.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipc-channels';
import type {
  Album,
  MediaDirectory,
  HeatmapData,
  IpcResult,
  SmartPlaylist,
  MediaMetadata,
  MediaLibraryItem,
} from '../core/types';

import type { FileSystemEntry } from '../core/file-system';

export interface LoadResult {
  type: 'data-url' | 'http-url' | 'error';
  url?: string;
  message?: string;
}

export interface ElectronAPI {
  loadFileAsDataURL: (filePath: string) => Promise<IpcResult<LoadResult>>;
  recordMediaView: (filePath: string) => Promise<IpcResult<void>>;
  getMediaViewCounts: (
    filePaths: string[],
  ) => Promise<IpcResult<{ [filePath: string]: number }>>;
  getAlbumsWithViewCounts: () => Promise<IpcResult<Album[]>>;
  reindexMediaLibrary: () => Promise<IpcResult<Album[]>>;
  addMediaDirectory: (path?: string) => Promise<IpcResult<string | null>>;
  removeMediaDirectory: (directoryPath: string) => Promise<IpcResult<void>>;
  setDirectoryActiveState: (
    directoryPath: string,
    isActive: boolean,
  ) => Promise<IpcResult<void>>;
  getMediaDirectories: () => Promise<IpcResult<MediaDirectory[]>>;
  getSupportedExtensions: () => Promise<
    IpcResult<{
      images: string[];
      videos: string[];
      all: string[];
    }>
  >;
  getServerPort: () => Promise<IpcResult<number>>;
  openInVlc: (
    filePath: string,
  ) => Promise<IpcResult<{ success: boolean; message?: string }>>;
  openExternal: (url: string) => Promise<IpcResult<void>>;
  getVideoMetadata: (
    filePath: string,
  ) => Promise<IpcResult<{ duration?: number; error?: string }>>;
  getHeatmap: (
    filePath: string,
    points?: number,
  ) => Promise<IpcResult<HeatmapData>>;
  getHeatmapProgress: (filePath: string) => Promise<IpcResult<number | null>>;
  getHlsStatus: (
    filePath: string,
  ) => Promise<
    IpcResult<{ currentTime: number; duration: number; percent: number } | null>
  >;
  listDirectory: (
    directoryPath: string,
  ) => Promise<IpcResult<FileSystemEntry[]>>;
  getParentDirectory: (path: string) => Promise<IpcResult<string | null>>;

  // Smart Playlists & Metadata
  upsertMetadata: (
    filePath: string,
    metadata: MediaMetadata,
  ) => Promise<IpcResult<void>>;
  getMetadata: (
    filePaths: string[],
  ) => Promise<IpcResult<{ [path: string]: MediaMetadata }>>;
  setRating: (filePath: string, rating: number) => Promise<IpcResult<void>>;
  createSmartPlaylist: (
    name: string,
    criteria: string,
  ) => Promise<IpcResult<{ id: number }>>;
  getSmartPlaylists: () => Promise<IpcResult<SmartPlaylist[]>>;
  deleteSmartPlaylist: (id: number) => Promise<IpcResult<void>>;
  updateSmartPlaylist: (
    id: number,
    name: string,
    criteria: string,
  ) => Promise<IpcResult<void>>;
  updateWatchedSegments: (
    filePath: string,
    segmentsJson: string,
  ) => Promise<IpcResult<void>>;

  executeSmartPlaylist: (
    criteria: string,
  ) => Promise<IpcResult<MediaLibraryItem[]>>;

  getAllMetadataAndStats: () => Promise<IpcResult<MediaLibraryItem[]>>;
  getRecentlyPlayed: (limit?: number) => Promise<IpcResult<MediaLibraryItem[]>>;
  extractMetadata: (filePaths: string[]) => Promise<IpcResult<void>>;

  // Google Drive
  checkGoogleDriveAuth: () => Promise<IpcResult<boolean>>;
  startGoogleDriveAuth: () => Promise<IpcResult<string>>;
  submitGoogleDriveAuthCode: (code: string) => Promise<IpcResult<boolean>>;
  addGoogleDriveSource: (
    folderId: string,
  ) => Promise<IpcResult<{ name?: string }>>;
  listGoogleDriveDirectory: (
    folderId: string,
  ) => Promise<IpcResult<FileSystemEntry[]>>;
  getGoogleDriveParent: (folderId: string) => Promise<IpcResult<string | null>>;

  // Theme
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
}

// Expose a controlled API to the renderer process via `window.electronAPI`.
const api: ElectronAPI = {
  loadFileAsDataURL: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LOAD_FILE_AS_DATA_URL, filePath),

  recordMediaView: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.RECORD_MEDIA_VIEW, filePath),

  getMediaViewCounts: (filePaths: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MEDIA_VIEW_COUNTS, filePaths),

  getAlbumsWithViewCounts: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_ALBUMS_WITH_VIEW_COUNTS),

  reindexMediaLibrary: () =>
    ipcRenderer.invoke(IPC_CHANNELS.REINDEX_MEDIA_LIBRARY),

  addMediaDirectory: (path?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_MEDIA_DIRECTORY, path),

  removeMediaDirectory: (directoryPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOVE_MEDIA_DIRECTORY, directoryPath),

  setDirectoryActiveState: (directoryPath: string, isActive: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_DIRECTORY_ACTIVE_STATE, {
      directoryPath,
      isActive,
    }),

  getMediaDirectories: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_MEDIA_DIRECTORIES),

  getSupportedExtensions: () =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_SUPPORTED_EXTENSIONS),

  getServerPort: () => ipcRenderer.invoke(IPC_CHANNELS.GET_SERVER_PORT),

  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),

  openInVlc: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.OPEN_IN_VLC, filePath),

  getVideoMetadata: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_VIDEO_METADATA, filePath),

  getHeatmap: (filePath: string, points?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_HEATMAP, filePath, points),

  getHeatmapProgress: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_HEATMAP_PROGRESS, filePath),

  getHlsStatus: (filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_HLS_STATUS, filePath),

  listDirectory: (directoryPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_DIRECTORY, directoryPath),

  getParentDirectory: (path: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GET_PARENT_DIRECTORY, path),

  upsertMetadata: (filePath: string, metadata: MediaMetadata) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPSERT_METADATA, { filePath, metadata }),

  getMetadata: (filePaths: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_METADATA, filePaths),

  setRating: (filePath: string, rating: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_SET_RATING, { filePath, rating }),

  createSmartPlaylist: (name: string, criteria: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_CREATE_SMART_PLAYLIST, {
      name,
      criteria,
    }),

  getSmartPlaylists: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_SMART_PLAYLISTS),

  deleteSmartPlaylist: (id: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_DELETE_SMART_PLAYLIST, id),

  updateSmartPlaylist: (id: number, name: string, criteria: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_SMART_PLAYLIST, {
      id,
      name,
      criteria,
    }),
  updateWatchedSegments: (filePath: string, segmentsJson: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS, {
      filePath,
      segmentsJson,
    }),

  executeSmartPlaylist: (criteria: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_EXECUTE_SMART_PLAYLIST, criteria),

  getAllMetadataAndStats: () =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_ALL_METADATA_AND_STATS),

  getRecentlyPlayed: (limit?: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.DB_GET_RECENTLY_PLAYED, limit),

  extractMetadata: (filePaths: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.MEDIA_EXTRACT_METADATA, filePaths),

  // Auth / Drive
  checkGoogleDriveAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_STATUS),
  startGoogleDriveAuth: () =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START),
  submitGoogleDriveAuthCode: (code: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_GOOGLE_DRIVE_CODE, code),
  addGoogleDriveSource: (folderId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE, folderId),

  listGoogleDriveDirectory: (folderId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DRIVE_LIST_DIRECTORY, folderId),

  getGoogleDriveParent: (folderId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.DRIVE_GET_PARENT, folderId),

  setTheme: (theme: 'light' | 'dark' | 'system') =>
    ipcRenderer.send(IPC_CHANNELS.THEME_CHANGED, theme),
};

contextBridge.exposeInMainWorld('electronAPI', api);
