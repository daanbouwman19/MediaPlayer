import type {
  MediaMetadata,
  SmartPlaylist,
  MediaLibraryItem,
} from '../../core/media/types';

export const DATABASE_IPC_CHANNELS = {
  DB_UPSERT_METADATA: 'db:upsert-metadata',
  DB_GET_METADATA: 'db:get-metadata',
  DB_SET_RATING: 'db:set-rating',
  DB_CREATE_SMART_PLAYLIST: 'db:create-smart-playlist',
  DB_GET_SMART_PLAYLISTS: 'db:get-smart-playlists',
  DB_DELETE_SMART_PLAYLIST: 'db:delete-smart-playlist',
  DB_UPDATE_SMART_PLAYLIST: 'db:update-smart-playlist',
  DB_UPDATE_WATCHED_SEGMENTS: 'db:update-watched-segments',
  DB_UPDATE_PLAYBACK_POSITION: 'db:update-playback-position',
  DB_EXECUTE_SMART_PLAYLIST: 'db:execute-smart-playlist',
  DB_GET_ALL_METADATA_AND_STATS: 'db:get-all-metadata-and-stats',
} as const;

export interface DatabaseIpcContract {
  [DATABASE_IPC_CHANNELS.DB_UPSERT_METADATA]: {
    payload: [{ filePath: string; metadata: MediaMetadata }];
    response: void;
  };
  [DATABASE_IPC_CHANNELS.DB_GET_METADATA]: {
    payload: [string[]];
    response: { [path: string]: MediaMetadata };
  };
  [DATABASE_IPC_CHANNELS.DB_SET_RATING]: {
    payload: [{ filePath: string; rating: number }];
    response: void;
  };
  [DATABASE_IPC_CHANNELS.DB_CREATE_SMART_PLAYLIST]: {
    payload: [{ name: string; criteria: string }];
    response: { id: number };
  };
  [DATABASE_IPC_CHANNELS.DB_GET_SMART_PLAYLISTS]: {
    payload: [];
    response: SmartPlaylist[];
  };
  [DATABASE_IPC_CHANNELS.DB_DELETE_SMART_PLAYLIST]: {
    payload: [number];
    response: void;
  };
  [DATABASE_IPC_CHANNELS.DB_UPDATE_SMART_PLAYLIST]: {
    payload: [{ id: number; name: string; criteria: string }];
    response: void;
  };
  [DATABASE_IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS]: {
    payload: [{ filePath: string; segmentsJson: string }];
    response: void;
  };
  [DATABASE_IPC_CHANNELS.DB_UPDATE_PLAYBACK_POSITION]: {
    payload: [{ filePath: string; position: number }];
    response: void;
  };
  [DATABASE_IPC_CHANNELS.DB_EXECUTE_SMART_PLAYLIST]: {
    payload: [string];
    response: MediaLibraryItem[];
  };
  [DATABASE_IPC_CHANNELS.DB_GET_ALL_METADATA_AND_STATS]: {
    payload: [];
    response: MediaLibraryItem[];
  };
}
