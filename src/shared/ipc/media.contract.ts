import type {
  Album,
  HeatmapData,
  MediaLibraryItem,
  TranscodeJob,
} from '../../core/media/types';
import type { FileSystemEntry } from '../../core/media/file-system';

export const MEDIA_IPC_CHANNELS = {
  LOAD_FILE_AS_DATA_URL: 'load-file-as-data-url',
  RECORD_MEDIA_VIEW: 'record-media-view',
  GET_MEDIA_VIEW_COUNTS: 'get-media-view-counts',
  GET_VIDEO_METADATA: 'get-video-metadata',
  GET_ALBUMS_WITH_VIEW_COUNTS: 'get-albums-with-view-counts',
  GET_HEATMAP: 'get-heatmap',
  GET_HEATMAP_PROGRESS: 'get-heatmap-progress',
  GET_HLS_STATUS: 'get-hls-status',
  DB_GET_RECENTLY_PLAYED: 'db:get-recently-played',
  MEDIA_EXTRACT_METADATA: 'media:extract-metadata',
  REINDEX_MEDIA_LIBRARY: 'reindex-media-library',
  DRIVE_LIST_DIRECTORY: 'drive:list-directory',
  DRIVE_GET_PARENT: 'drive:get-parent',
  DRIVE_CACHE_STATUS: 'drive:cache-status',
  DRIVE_CACHE_TRIGGER: 'drive:cache-trigger',
  DRIVE_CACHE_PROGRESS: 'drive:cache-progress',
  TRANSCODE_JOB_ADD: 'transcode-job:add',
  TRANSCODE_JOB_LIST: 'transcode-job:list',
  TRANSCODE_JOB_CANCEL: 'transcode-job:cancel',
} as const;

export interface MediaIpcContract {
  [MEDIA_IPC_CHANNELS.LOAD_FILE_AS_DATA_URL]: {
    payload: [string, { preferHttp?: boolean }?];
    response: {
      type: 'data-url' | 'http-url' | 'error';
      url?: string;
      message?: string;
    };
  };
  [MEDIA_IPC_CHANNELS.RECORD_MEDIA_VIEW]: {
    payload: [string];
    response: void;
  };
  [MEDIA_IPC_CHANNELS.GET_MEDIA_VIEW_COUNTS]: {
    payload: [string[]];
    response: { [filePath: string]: number };
  };
  [MEDIA_IPC_CHANNELS.GET_VIDEO_METADATA]: {
    payload: [string];
    response: { duration?: number; error?: string };
  };
  [MEDIA_IPC_CHANNELS.GET_ALBUMS_WITH_VIEW_COUNTS]: {
    payload: [];
    response: Album[];
  };
  [MEDIA_IPC_CHANNELS.GET_HEATMAP]: {
    payload: [string, number?];
    response: HeatmapData;
  };
  [MEDIA_IPC_CHANNELS.GET_HEATMAP_PROGRESS]: {
    payload: [string];
    response: number | null;
  };
  [MEDIA_IPC_CHANNELS.GET_HLS_STATUS]: {
    payload: [string];
    response: { currentTime: number; duration: number; percent: number } | null;
  };
  [MEDIA_IPC_CHANNELS.DB_GET_RECENTLY_PLAYED]: {
    payload: [number];
    response: MediaLibraryItem[];
  };
  [MEDIA_IPC_CHANNELS.MEDIA_EXTRACT_METADATA]: {
    payload: [string[]];
    response: void;
  };
  [MEDIA_IPC_CHANNELS.REINDEX_MEDIA_LIBRARY]: {
    payload: [];
    response: Album[];
  };
  [MEDIA_IPC_CHANNELS.DRIVE_LIST_DIRECTORY]: {
    payload: [string];
    response: FileSystemEntry[];
  };
  [MEDIA_IPC_CHANNELS.DRIVE_GET_PARENT]: {
    payload: [string];
    response: string | null;
  };
  [MEDIA_IPC_CHANNELS.DRIVE_CACHE_STATUS]: {
    payload: [string];
    response: { status: 'ready' | 'syncing' | 'cloud'; progress: number };
  };
  [MEDIA_IPC_CHANNELS.DRIVE_CACHE_TRIGGER]: {
    payload: [string];
    response: void;
  };
  [MEDIA_IPC_CHANNELS.TRANSCODE_JOB_ADD]: {
    payload: [string[]];
    response: void;
  };
  [MEDIA_IPC_CHANNELS.TRANSCODE_JOB_LIST]: {
    payload: [];
    response: TranscodeJob[];
  };
  [MEDIA_IPC_CHANNELS.TRANSCODE_JOB_CANCEL]: {
    payload: [string];
    response: void;
  };
}
