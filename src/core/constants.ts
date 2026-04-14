/**
 * @file Defines constants used throughout the core of the application.
 */

/**
 * Protocol prefix for Google Drive files.
 */
const GDRIVE_PROTOCOL: string = 'gdrive://';

/**
 * Maximum size for a file to be loaded as a Data URL, in megabytes.
 * Larger files, especially videos, will be served via a local HTTP server
 * to avoid performance issues with large Data URLs.
 * @type {number}
 */
const MAX_DATA_URL_SIZE_MB: number = 50;

/**
 * Threshold for switching to HTTP serving instead of Data URL to avoid memory pressure.
 */
const DATA_URL_THRESHOLD_MB: number = 1;

/**
 * Threshold for switching to HTTP serving in bytes.
 */
const DATA_URL_THRESHOLD_BYTES: number = DATA_URL_THRESHOLD_MB * 1024 * 1024;

/**
 * The key used for storing and retrieving the file index cache
 * in the application's SQLite database.
 */
const FILE_INDEX_CACHE_KEY: string = 'file_index_json';

/**
 * An array of supported image file extensions.
 * Used to identify image files during media scans.
 */
const SUPPORTED_IMAGE_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
] as const;

/**
 * An array of supported video file extensions.
 * Used to identify video files during media scans.
 */
const SUPPORTED_VIDEO_EXTENSIONS: readonly string[] = [
  '.mp4',
  '.webm',
  '.ogg',
  '.mov',
  '.avi',
  '.mkv',
  '.wmv',
  '.flv',
] as const;

/**
 * A combined array of all supported media file extensions (both images and videos).
 * This is useful for file filtering operations.
 */
const ALL_SUPPORTED_EXTENSIONS: readonly string[] = [
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
] as const;

/**
 * O(1) lookup sets for supported extensions.
 */
const SUPPORTED_IMAGE_EXTENSIONS_SET = new Set(SUPPORTED_IMAGE_EXTENSIONS);
const SUPPORTED_VIDEO_EXTENSIONS_SET = new Set(SUPPORTED_VIDEO_EXTENSIONS);
const ALL_SUPPORTED_EXTENSIONS_SET = new Set(ALL_SUPPORTED_EXTENSIONS);

/**
 * Formats that often fail in browsers or have poor performance
 * and should trigger proactive transcoding.
 */
const LEGACY_VIDEO_EXTENSIONS: readonly string[] = [
  '.mov',
  '.avi',
  '.wmv',
  '.mkv',
  '.flv',
] as const;

/**
 * Available media filters in the UI.
 */
const MEDIA_FILTERS = ['All', 'Images', 'Videos'] as const;

/**
 * Type derived from MEDIA_FILTERS for use in the UI and filtering logic.
 */
export type MediaFilter = (typeof MEDIA_FILTERS)[number];

/**
 * List of sensitive subdirectories that should never be accessed.
 */
const SENSITIVE_SUBDIRECTORIES = new Set([
  '.ssh',
  '.aws',
  '.kube',
  '.gnupg',
  '.git',
  '.env',
  '.npmrc',
  '.docker',
  'docker-compose.yml',
  'docker-compose.override.yml',
  'Dockerfile',
  '.bash_history',
  '.zsh_history',
  '.sh_history',
  '.DS_Store',
  'Thumbs.db',
  '.gitignore',
  '.gitattributes',
  'node_modules',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  // Shell Configuration
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  '.bash_login',
  '.bash_logout',
  '.zprofile',
  '.zlogin',
  '.zlogout',
  // SSH & Auth
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'known_hosts',
  'authorized_keys',
  '.htpasswd',
  '.netrc',
  // App Specific
  'server.key',
  'server.crt',
  'server.cert',
  // System & User Data
  'appdata', // Windows user data (Cookies, Passwords, etc.)
  'library', // macOS user data (Keychains, Mail, etc.)
  'ntuser.dat', // Windows Registry Hive
  'ntuser.dat.log1',
  'ntuser.dat.log2',
  'autorun.inf',
  'boot.ini',
  'bootmgr',
  'bootsect.bak',
]);

/**
 * List of SSH key prefixes to block.
 * Blocks variations like id_rsa, id_rsa.old, etc., but allows .pub files.
 */
const SSH_KEY_PREFIXES = [
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
] as const;

/**
 * List of file prefixes that should be considered sensitive.
 * This includes configuration files, lock files, and environment files.
 */
const SENSITIVE_FILE_PREFIXES = [
  // Server Certs
  'server.key',
  'server.crt',
  'master.key',
  'server.cert',
  // Docker
  'dockerfile',
  'docker-compose',
  // Package Managers
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  '.npmrc',
  // Env & Auth
  '.env',
  '.htpasswd',
  '.netrc',
  // Shell History & Config
  '.bash_history',
  '.zsh_history',
  '.sh_history',
  '.bashrc',
  '.zshrc',
  '.profile',
  '.bash_profile',
  // System
  'autorun.inf',
  'boot.ini',
  'bootmgr',
  'ntuser.dat',
] as const;

/**
 * Windows-specific restricted system paths.
 */
const WINDOWS_RESTRICTED_ROOT_PATHS = [
  'Windows',
  'Program Files',
  'Program Files (x86)',
  'ProgramData',
];

/**
 * Limit concurrent file system scans to avoid EMFILE errors.
 */
const DISK_SCAN_CONCURRENCY = 10;

/**
 * Concurrency for background metadata extraction.
 */
const METADATA_EXTRACTION_CONCURRENCY = 5;

/**
 * Batch size for saving extracted metadata to the database.
 */
const METADATA_BATCH_SIZE = 50;

/**
 * Minimum number of files required to switch to the lightweight metadata verification query.
 */
const METADATA_VERIFICATION_THRESHOLD = 1000;

/**
 * Scopes required for Google Drive access.
 */
const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

/**
 * Database key for storing Google OAuth tokens.
 */
const GOOGLE_TOKENS_KEY = 'google_tokens';

/**
 * Default port for the web server.
 */
const DEFAULT_SERVER_PORT = 3000;

/**
 * Default host for the web server.
 */
const DEFAULT_SERVER_HOST = '127.0.0.1';

/**
 * Limit for fetching recently played items.
 */
const RECENTLY_PLAYED_FETCH_LIMIT = 100;

/**
 * Timeout for hiding UI controls in milliseconds.
 */
const CONTROLS_HIDE_TIMEOUT_MS = 3000;

/**
 * Rate Limiting Constants
 */

// Auth: Strict limit (20 req / 15 min) to prevent brute force
const RATE_LIMIT_AUTH_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_AUTH_MAX_REQUESTS = 20;

// Write: Moderate limit (10 req / 1 min) for sensitive write operations (scan, create, rate)
const RATE_LIMIT_WRITE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_WRITE_MAX_REQUESTS = 10;

// Read: For metadata/albums browsing (600 req / 1 min)
const RATE_LIMIT_READ_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_READ_MAX_REQUESTS = 600;

// File/Expensive: For streaming/thumbnails/listing (3000 req / 1 min)
const RATE_LIMIT_FILE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_FILE_MAX_REQUESTS = 3_000;

// Filesystem/Browsing: Very strict limit (60 req / 1 min) for directory listing
const RATE_LIMIT_FS_READ_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_FS_READ_MAX_REQUESTS = 60;

/**
 * Maximum number of concurrent transcoding streams allowed.
 * Used to prevent CPU exhaustion (DoS).
 */
const MAX_CONCURRENT_TRANSCODES = 10;

/**
 * Maximum number of items allowed in a batch API request.
 * Used to prevent Denial of Service (DoS) attacks via large payloads.
 */
const MAX_API_BATCH_SIZE = 1000;

/**
 * Maximum allowed length for passwords.
 * Used to prevent CPU exhaustion DoS attacks on expensive hashing algorithms.
 */
const MAX_PASSWORD_LENGTH = 256;

/**
 * Duration of each HLS segment in seconds.
 */
const HLS_SEGMENT_DURATION = 6;

/**
 * Name of the directory within the cache for HLS segments.
 */
const HLS_CACHE_DIR_NAME = 'hls';

/**
 * Name of the directory within the cache for heatmaps.
 */
const HEATMAP_CACHE_DIR_NAME = 'heatmaps';

/**
 * Grid View Breakpoints (Tailwind)
 */
const GRID_BREAKPOINT_SM = 640;
const GRID_BREAKPOINT_LG = 1024;
const GRID_BREAKPOINT_XL = 1280;

/**
 * Timeout for worker scan operations (24 hours).
 */
const WORKER_SCAN_TIMEOUT_MS = 86400000;

/**
 * Maximum length of a file path to process.
 * Used to prevent potential DoS or ReDoS with extremely long paths.
 */
const MAX_PATH_LENGTH = 4096;

export {
  GDRIVE_PROTOCOL,
  MAX_DATA_URL_SIZE_MB,
  DATA_URL_THRESHOLD_MB,
  DATA_URL_THRESHOLD_BYTES,
  FILE_INDEX_CACHE_KEY,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS_SET,
  SUPPORTED_VIDEO_EXTENSIONS_SET,
  ALL_SUPPORTED_EXTENSIONS_SET,
  LEGACY_VIDEO_EXTENSIONS,
  MEDIA_FILTERS,
  SENSITIVE_SUBDIRECTORIES,
  SSH_KEY_PREFIXES,
  SENSITIVE_FILE_PREFIXES,
  WINDOWS_RESTRICTED_ROOT_PATHS,
  DISK_SCAN_CONCURRENCY,
  METADATA_EXTRACTION_CONCURRENCY,
  METADATA_BATCH_SIZE,
  METADATA_VERIFICATION_THRESHOLD,
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_TOKENS_KEY,
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_HOST,
  RECENTLY_PLAYED_FETCH_LIMIT,
  CONTROLS_HIDE_TIMEOUT_MS,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_WRITE_WINDOW_MS,
  RATE_LIMIT_WRITE_MAX_REQUESTS,
  RATE_LIMIT_READ_WINDOW_MS,
  RATE_LIMIT_READ_MAX_REQUESTS,
  RATE_LIMIT_FILE_WINDOW_MS,
  RATE_LIMIT_FILE_MAX_REQUESTS,
  RATE_LIMIT_FS_READ_WINDOW_MS,
  RATE_LIMIT_FS_READ_MAX_REQUESTS,
  MAX_CONCURRENT_TRANSCODES,
  MAX_API_BATCH_SIZE,
  MAX_PASSWORD_LENGTH,
  HLS_SEGMENT_DURATION,
  HLS_CACHE_DIR_NAME,
  HEATMAP_CACHE_DIR_NAME,
  GRID_BREAKPOINT_SM,
  GRID_BREAKPOINT_LG,
  GRID_BREAKPOINT_XL,
  WORKER_SCAN_TIMEOUT_MS,
  MAX_PATH_LENGTH,
};
