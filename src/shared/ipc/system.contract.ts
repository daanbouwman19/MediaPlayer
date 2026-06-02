import type { MediaDirectory } from '../../core/media/types';
import type { FileSystemEntry } from '../../core/media/file-system';

export const SYSTEM_IPC_CHANNELS = {
  ADD_MEDIA_DIRECTORY: 'add-media-directory',
  REMOVE_MEDIA_DIRECTORY: 'remove-media-directory',
  SET_DIRECTORY_ACTIVE_STATE: 'set-directory-active-state',
  GET_MEDIA_DIRECTORIES: 'get-media-directories',
  GET_SUPPORTED_EXTENSIONS: 'get-supported-extensions',
  GET_SERVER_PORT: 'get-server-port',
  OPEN_EXTERNAL: 'open-external',
  OPEN_IN_VLC: 'open-in-vlc',
  LIST_DIRECTORY: 'list-directory',
  GET_PARENT_DIRECTORY: 'get-parent-directory',
  THEME_CHANGED: 'theme-changed',
} as const;

export interface SystemIpcContract {
  [SYSTEM_IPC_CHANNELS.ADD_MEDIA_DIRECTORY]: {
    payload: [string?];
    response: string | null;
  };
  [SYSTEM_IPC_CHANNELS.REMOVE_MEDIA_DIRECTORY]: {
    payload: [string];
    response: void;
  };
  [SYSTEM_IPC_CHANNELS.SET_DIRECTORY_ACTIVE_STATE]: {
    payload: [{ directoryPath: string; isActive: boolean }];
    response: void;
  };
  [SYSTEM_IPC_CHANNELS.GET_MEDIA_DIRECTORIES]: {
    payload: [];
    response: MediaDirectory[];
  };
  [SYSTEM_IPC_CHANNELS.GET_SUPPORTED_EXTENSIONS]: {
    payload: [];
    response: {
      images: readonly string[];
      videos: readonly string[];
      all: readonly string[];
    };
  };
  [SYSTEM_IPC_CHANNELS.GET_SERVER_PORT]: {
    payload: [];
    response: number;
  };
  [SYSTEM_IPC_CHANNELS.OPEN_EXTERNAL]: {
    payload: [string];
    response: void;
  };
  [SYSTEM_IPC_CHANNELS.OPEN_IN_VLC]: {
    payload: [string];
    response: { success: boolean; message?: string };
  };
  [SYSTEM_IPC_CHANNELS.LIST_DIRECTORY]: {
    payload: [string];
    response: FileSystemEntry[];
  };
  [SYSTEM_IPC_CHANNELS.GET_PARENT_DIRECTORY]: {
    payload: [string];
    response: string | null;
  };
}
