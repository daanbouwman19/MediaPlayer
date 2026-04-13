export const IPC_CHANNELS = {
  LOAD_FILE_AS_DATA_URL: 'load-file-as-data-url',
  RECORD_MEDIA_VIEW: 'record-media-view',
  GET_MEDIA_VIEW_COUNTS: 'get-media-view-counts',
  GET_VIDEO_METADATA: 'get-video-metadata',
  GET_HEATMAP: 'get-heatmap',
  GET_HEATMAP_PROGRESS: 'get-heatmap-progress',
  GET_HLS_STATUS: 'get-hls-status',
  GET_ALBUMS_WITH_VIEW_COUNTS: 'get-albums-with-view-counts',
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

  // Database
  DB_UPSERT_METADATA: 'db:upsert-metadata',
  DB_GET_METADATA: 'db:get-metadata',
  DB_SET_RATING: 'db:set-rating',
  DB_CREATE_SMART_PLAYLIST: 'db:create-smart-playlist',
  DB_GET_SMART_PLAYLISTS: 'db:get-smart-playlists',
  DB_DELETE_SMART_PLAYLIST: 'db:delete-smart-playlist',
  DB_UPDATE_SMART_PLAYLIST: 'db:update-smart-playlist',
  DB_UPDATE_WATCHED_SEGMENTS: 'db:update-watched-segments',
  DB_EXECUTE_SMART_PLAYLIST: 'db:execute-smart-playlist',
  DB_GET_ALL_METADATA_AND_STATS: 'db:get-all-metadata-and-stats',
  DB_GET_RECENTLY_PLAYED: 'db:get-recently-played',

  // Media
  MEDIA_EXTRACT_METADATA: 'media:extract-metadata',
  REINDEX_MEDIA_LIBRARY: 'reindex-media-library',

  // Auth / Drive
  AUTH_GOOGLE_DRIVE_STATUS: 'auth:google-drive-status',
  AUTH_GOOGLE_DRIVE_START: 'auth:google-drive-start',
  AUTH_GOOGLE_DRIVE_CODE: 'auth:google-drive-code',
  ADD_GOOGLE_DRIVE_SOURCE: 'add-google-drive-source',
  DRIVE_LIST_DIRECTORY: 'drive:list-directory',
  DRIVE_GET_PARENT: 'drive:get-parent',

  // Theme
  THEME_CHANGED: 'theme-changed',
} as const;
