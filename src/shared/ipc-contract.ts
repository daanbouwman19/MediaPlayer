import { IPC_CHANNELS } from './ipc-channels';
import type {
  Album,
  MediaDirectory,
  MediaLibraryItem,
  MediaMetadata,
  SmartPlaylist,
  HeatmapData,
  TranscodeJob,
} from '../core/types';
import type { FileSystemEntry } from '../core/file-system';

export interface IpcContract {
  [IPC_CHANNELS.LOAD_FILE_AS_DATA_URL]: {
    payload: [string, { preferHttp?: boolean }?];
    response: {
      type: 'data-url' | 'http-url' | 'error';
      url?: string;
      message?: string;
    };
  };
  [IPC_CHANNELS.RECORD_MEDIA_VIEW]: {
    payload: [string];
    response: void;
  };
  [IPC_CHANNELS.GET_MEDIA_VIEW_COUNTS]: {
    payload: [string[]];
    response: { [filePath: string]: number };
  };
  [IPC_CHANNELS.GET_VIDEO_METADATA]: {
    payload: [string];
    response: { duration?: number; error?: string };
  };
  [IPC_CHANNELS.GET_ALBUMS_WITH_VIEW_COUNTS]: {
    payload: [];
    response: Album[];
  };
  [IPC_CHANNELS.GET_HEATMAP]: {
    payload: [string, number?];
    response: HeatmapData;
  };
  [IPC_CHANNELS.GET_HEATMAP_PROGRESS]: {
    payload: [string];
    response: number | null;
  };
  [IPC_CHANNELS.GET_HLS_STATUS]: {
    payload: [string];
    response: { currentTime: number; duration: number; percent: number } | null;
  };
  [IPC_CHANNELS.ADD_MEDIA_DIRECTORY]: {
    payload: [string?];
    response: string | null;
  };
  [IPC_CHANNELS.REMOVE_MEDIA_DIRECTORY]: {
    payload: [string];
    response: void;
  };
  [IPC_CHANNELS.SET_DIRECTORY_ACTIVE_STATE]: {
    payload: [{ directoryPath: string; isActive: boolean }];
    response: void;
  };
  [IPC_CHANNELS.GET_MEDIA_DIRECTORIES]: {
    payload: [];
    response: MediaDirectory[];
  };
  [IPC_CHANNELS.GET_SUPPORTED_EXTENSIONS]: {
    payload: [];
    response: {
      images: readonly string[];
      videos: readonly string[];
      all: readonly string[];
    };
  };
  [IPC_CHANNELS.GET_SERVER_PORT]: {
    payload: [];
    response: number;
  };
  [IPC_CHANNELS.OPEN_EXTERNAL]: {
    payload: [string];
    response: void;
  };
  [IPC_CHANNELS.OPEN_IN_VLC]: {
    payload: [string];
    response: { success: boolean; message?: string };
  };
  [IPC_CHANNELS.LIST_DIRECTORY]: {
    payload: [string];
    response: FileSystemEntry[];
  };
  [IPC_CHANNELS.GET_PARENT_DIRECTORY]: {
    payload: [string];
    response: string | null;
  };
  [IPC_CHANNELS.DB_UPSERT_METADATA]: {
    payload: [{ filePath: string; metadata: MediaMetadata }];
    response: void;
  };
  [IPC_CHANNELS.DB_GET_METADATA]: {
    payload: [string[]];
    response: { [path: string]: MediaMetadata };
  };
  [IPC_CHANNELS.DB_SET_RATING]: {
    payload: [{ filePath: string; rating: number }];
    response: void;
  };
  [IPC_CHANNELS.DB_CREATE_SMART_PLAYLIST]: {
    payload: [{ name: string; criteria: string }];
    response: { id: number };
  };
  [IPC_CHANNELS.DB_GET_SMART_PLAYLISTS]: {
    payload: [];
    response: SmartPlaylist[];
  };
  [IPC_CHANNELS.DB_DELETE_SMART_PLAYLIST]: {
    payload: [number];
    response: void;
  };
  [IPC_CHANNELS.DB_UPDATE_SMART_PLAYLIST]: {
    payload: [{ id: number; name: string; criteria: string }];
    response: void;
  };
  [IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS]: {
    payload: [{ filePath: string; segmentsJson: string }];
    response: void;
  };
  [IPC_CHANNELS.DB_UPDATE_PLAYBACK_POSITION]: {
    payload: [{ filePath: string; position: number }];
    response: void;
  };
  [IPC_CHANNELS.DB_EXECUTE_SMART_PLAYLIST]: {
    payload: [string];
    response: MediaLibraryItem[];
  };
  [IPC_CHANNELS.DB_GET_ALL_METADATA_AND_STATS]: {
    payload: [];
    response: MediaLibraryItem[];
  };
  [IPC_CHANNELS.DB_GET_RECENTLY_PLAYED]: {
    payload: [number];
    response: MediaLibraryItem[];
  };
  [IPC_CHANNELS.MEDIA_EXTRACT_METADATA]: {
    payload: [string[]];
    response: void;
  };
  [IPC_CHANNELS.REINDEX_MEDIA_LIBRARY]: {
    payload: [];
    response: Album[];
  };
  [IPC_CHANNELS.AUTH_GOOGLE_DRIVE_STATUS]: {
    payload: [];
    response: boolean;
  };
  [IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START]: {
    payload: [];
    response: string;
  };
  [IPC_CHANNELS.AUTH_GOOGLE_DRIVE_CODE]: {
    payload: [string];
    response: boolean;
  };
  [IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE]: {
    payload: [string];
    response: { name?: string };
  };
  [IPC_CHANNELS.DRIVE_LIST_DIRECTORY]: {
    payload: [string];
    response: FileSystemEntry[];
  };
  [IPC_CHANNELS.DRIVE_GET_PARENT]: {
    payload: [string];
    response: string | null;
  };
  [IPC_CHANNELS.TRANSCODE_JOB_ADD]: {
    payload: [string[]];
    response: void;
  };
  [IPC_CHANNELS.TRANSCODE_JOB_LIST]: {
    payload: [];
    response: TranscodeJob[];
  };
  [IPC_CHANNELS.TRANSCODE_JOB_CANCEL]: {
    payload: [string];
    response: void;
  };
}
