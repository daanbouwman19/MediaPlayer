/**
 * @file Database Worker Thread - Handles all sqlite3 operations.
 * This worker runs in a separate thread to avoid blocking the main process.
 * It receives messages from the main thread to perform database operations
 * and sends results back via the worker messaging API.
 */

import { parentPort } from 'worker_threads';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import path from 'path';
import type { Album } from '../media/types.ts';
import { FILE_INDEX_CACHE_KEY } from '../media/constants.ts';
import { getDriveId, isDrivePath } from '../media/media-utils.ts';
import { assignFileIds, generateUniqueFileId } from '../media/utils/file-id.ts';
import {
  isExtractionBackedOff,
  isMetadataComplete,
} from '../media/utils/metadata-status.ts';
import {
  initializeDatabase,
  JOB_TYPE_TRANSCODE,
  SEGMENT_TYPE_WATCHED,
} from './database-schema.ts';
import { MAX_WATCHED_SEGMENTS } from './metadata-validation.ts';

// Extract the Statement type from return value of DatabaseSync.prepare or mock it
type StatementSync = ReturnType<DatabaseSync['prepare']>;

/**
 * The database instance for this worker thread.
 */
let db: DatabaseSync | null = null;

/** Names of the statements prepared by {@link initDatabase}. */
type StatementName =
  | 'addJob'
  | 'addMediaDirectory'
  | 'cacheAlbum'
  | 'createSmartPlaylist'
  | 'deleteCachedAlbum'
  | 'deleteJob'
  | 'deleteSmartPlaylist'
  | 'deleteWatchedSegments'
  | 'demoteLibraryPathsBatch'
  | 'ensureMetadataRow'
  | 'executeSmartPlaylist'
  | 'getActiveDirectoryPaths'
  | 'getAllMetadata'
  | 'getAllMetadataVerification'
  | 'getCachedAlbum'
  | 'getFileIdByPath'
  | 'getFileIdsByPathsBatch'
  | 'getLibraryMemberPaths'
  | 'getLibraryMemberPathsWithPrefix'
  | 'getLibraryPathsBatch'
  | 'getMediaDirectories'
  | 'getMediaDirectoryByPath'
  | 'getMediaViewCountsBatch'
  | 'getMetadataBatch'
  | 'getPathByFileId'
  | 'getPendingJobs'
  | 'getPendingMetadata'
  | 'getRecentlyPlayed'
  | 'getSetting'
  | 'getSmartPlaylists'
  | 'getExtractionStateBatch'
  | 'insertWatchedSegment'
  | 'listJobs'
  | 'promoteLibraryPathsBatch'
  | 'recordView'
  | 'removeMediaDirectory'
  | 'renameMediaDirectory'
  | 'repairDriveSourceName'
  | 'rewriteJobPathPrefix'
  | 'rewriteMetadataPathPrefix'
  | 'saveSetting'
  | 'setDirectoryActiveState'
  | 'updateJobStatus'
  | 'updatePlaybackPosition'
  | 'updateRating'
  | 'updateSmartPlaylist'
  | 'upsertMetadata';

/**
 * Cache for prepared statements to improve performance of repeated queries.
 * Keys are the statement names (e.g., 'recordView'), and values are the prepared SQLite statements.
 * Empty until {@link initDatabase} succeeds and after {@link closeDatabase}.
 */
const statements: Partial<Record<StatementName, StatementSync>> = {};

/**
 * Returns a prepared statement, throwing if the database has not been initialized.
 */
function getStatement(name: StatementName): StatementSync {
  const statement = statements[name];
  if (!statement) {
    throw new Error(
      `Statement "${name}" is not prepared; database not initialized`,
    );
  }
  return statement;
}

/**
 * Default batch size for SQL operations.
 * 900 is chosen to be safely within SQLite's default limit of 999 parameters.
 */
const SQL_BATCH_SIZE = 900;

/**
 * How long a statement waits for a lock held by another connection (e.g. a
 * second app instance) before failing with SQLITE_BUSY. SQLite's default of
 * 0 makes every concurrent write fail immediately.
 */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Correlated subquery that reassembles watched segments for the current
 * media_metadata row into the legacy JSON format ({start, end}[]), or NULL
 * when the file has no watched segments. Keeps the worker's message
 * contract unchanged while segments live in the media_segments table.
 */
const WATCHED_SEGMENTS_JSON = `NULLIF((SELECT json_group_array(json_object('start', s.start_time, 'end', s.end_time) ORDER BY s.start_time) FROM media_segments s WHERE s.file_path_hash = media_metadata.file_path_hash AND s.type = '${SEGMENT_TYPE_WATCHED}'), '[]')`;

/**
 * Base SELECT shared by both smart-playlist execution paths (the cached
 * empty-criteria statement and the dynamic-criteria query) so their row
 * shapes stay identical. Includes playback_position so resume position is
 * preserved regardless of whether criteria are present.
 */
const SMART_PLAYLIST_BASE_SELECT = `
      SELECT
        file_path_hash,
        file_path,
        duration,
        rating,
        created_at,
        COALESCE(view_count, 0) as view_count,
        last_viewed,
        playback_position
      FROM media_metadata
      WHERE in_library = 1 AND file_path IS NOT NULL`;

// Helper Functions

/**
 * Runs a prepared statement whose parameter list is exactly SQL_BATCH_SIZE
 * placeholders, over `keys` split into SQL_BATCH_SIZE-sized chunks. A short
 * final chunk is padded with NULLs so the cached statement is reused instead of
 * recompiling for a variable parameter count. Each returned row is handed to
 * `onRow`. Exceptions from the underlying query propagate to the caller.
 *
 * This centralizes the null-padding batch pattern that several read paths
 * (file-id, metadata, view-count, and existence lookups) would otherwise
 * duplicate.
 */
function forEachBatchedRow<T>(
  stmt: StatementSync,
  keys: string[],
  onRow: (row: T) => void,
): void {
  for (let i = 0; i < keys.length; i += SQL_BATCH_SIZE) {
    const batch = keys.slice(i, i + SQL_BATCH_SIZE);
    if (batch.length === 0) continue;
    const rows = stmt.all(...padBatch(batch)) as T[];
    for (const row of rows) onRow(row);
  }
}

/**
 * Write counterpart of {@link forEachBatchedRow}: runs a statement with
 * exactly SQL_BATCH_SIZE placeholders over `keys` in NULL-padded chunks.
 */
function runBatchedStatement(stmt: StatementSync, keys: string[]): void {
  for (let i = 0; i < keys.length; i += SQL_BATCH_SIZE) {
    const batch = keys.slice(i, i + SQL_BATCH_SIZE);
    if (batch.length === 0) continue;
    stmt.run(...padBatch(batch));
  }
}

/** Pads a short final batch with NULLs up to SQL_BATCH_SIZE parameters. */
function padBatch(batch: string[]): (string | null)[] {
  return batch.length === SQL_BATCH_SIZE
    ? batch
    : Object.assign(new Array(SQL_BATCH_SIZE).fill(null), batch);
}

/**
 * Runs `fn` inside a transaction, rolling back and rethrowing if it throws.
 * `fn` must be synchronous: other messages are handled whenever this thread
 * awaits, and their statements would otherwise run inside the transaction.
 */
function runInTransaction(fn: () => void): void {
  if (!db) throw new Error('Database not initialized');
  const database = db;
  database.exec('BEGIN');
  try {
    fn();
    database.exec('COMMIT');
  } catch (e) {
    try {
      database.exec('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[worker] Failed to rollback transaction:', rollbackErr);
    }
    throw e;
  }
}

/**
 * Helper to generate file IDs in batches to avoid EMFILE errors.
 * Optimization: Checks DB first to avoid fs.stat for known files.
 * @param filePaths - List of file paths.
 * @returns Map of filePath to fileId.
 */
async function generateFileIdsBatched(
  filePaths: string[],
): Promise<Map<string, string>> {
  const pathIdMap = new Map<string, string>();

  // 1. Check Database for existing IDs (avoid fs.stat)
  if (db && statements.getFileIdsByPathsBatch) {
    try {
      forEachBatchedRow<{ file_path: string; file_path_hash: string }>(
        statements.getFileIdsByPathsBatch,
        filePaths,
        (row) => {
          if (row.file_path) {
            pathIdMap.set(row.file_path, row.file_path_hash);
          }
        },
      );
    } catch (err) {
      console.warn(
        '[worker] Failed to query existing file IDs (falling back to generation):',
        err,
      );
    }
  }

  // 2. Identify missing paths
  // Use manual loop instead of Array.prototype.filter to avoid allocation overhead
  const missingPaths: string[] = [];
  for (const p of filePaths) {
    if (!pathIdMap.has(p)) {
      missingPaths.push(p);
    }
  }

  // 3. Process missing paths with fs.stat (limited concurrency). IDs that
  // already belong to another existing file (a copy) are disambiguated.
  const generated = await assignFileIds(missingPaths, lookupPathForFileId);
  for (const [filePath, fileId] of generated) {
    pathIdMap.set(filePath, fileId);
  }
  return pathIdMap;
}

/**
 * Returns the path stored for a file ID, used to detect ID collisions
 * between distinct files (see {@link assignFileIds}).
 */
function lookupPathForFileId(fileId: string): string | null {
  const stmt = statements.getPathByFileId;
  if (!db || !stmt) return null;
  try {
    const row = stmt.get(fileId) as { file_path: string | null } | undefined;
    return row?.file_path ?? null;
  } catch (err) {
    console.warn('[worker] Failed to look up path for file ID:', err);
    return null;
  }
}

/**
 * Helper to get an existing file ID from the database or generate one if not found.
 * Checks media_metadata first, then falls back to generation (fs.stat).
 */
async function getExistingIdOrGenerate(filePath: string): Promise<string> {
  try {
    const row = getStatement('getFileIdByPath').get(filePath) as
      | { file_path_hash: string }
      | undefined;
    if (row) {
      return row.file_path_hash;
    }
  } catch (error) {
    console.warn(
      `[worker] DB error while checking for existing file ID for ${filePath}:`,
      error,
    );
  }

  return generateUniqueFileId(filePath, lookupPathForFileId);
}

/**
 * Helper to check which paths already exist in the database.
 * @param filePaths - List of file paths to check.
 * @param libraryOnly - Only count rows that are library members
 *   (in_library = 1), so rows that exist without membership (stats-only rows
 *   from recordMediaView, v2-migration ghosts, client upserts) still get
 *   promoted by a scan confirmation.
 * @returns Set of file paths that exist.
 */
function getExistingPathsBatch(
  filePaths: string[],
  libraryOnly = false,
): Set<string> {
  const existingPaths = new Set<string>();
  const stmt = libraryOnly
    ? statements.getLibraryPathsBatch
    : statements.getFileIdsByPathsBatch;
  if (!db || !stmt) return existingPaths;

  try {
    forEachBatchedRow<{ file_path: string }>(stmt, filePaths, (row) => {
      if (row.file_path) {
        existingPaths.add(row.file_path);
      }
    });
  } catch (err) {
    console.warn('[worker] Error checking existing paths:', err);
  }
  return existingPaths;
}

// Library membership (in_library). A row is a library member when the last
// scan of an active source found its file. Only scans (cacheAlbums) promote
// rows; removing or deactivating a source demotes the files it provided.
// Drive files are authorized by membership alone (see security.ts).

/**
 * Hands every texture path in the given album trees to `onPath`, walking
 * iteratively. Tolerates malformed nodes, since trees also come from the
 * JSON cache.
 */
function forEachAlbumPath(
  albums: readonly Album[],
  onPath: (filePath: string) => void,
): void {
  const stack: Album[] = albums.slice();
  while (stack.length > 0) {
    const album = stack.pop();
    if (!album) continue;
    if (album.textures && Array.isArray(album.textures)) {
      for (const t of album.textures) {
        if (t && t.path) onPath(t.path);
      }
    }
    if (album.children && Array.isArray(album.children)) {
      for (let i = album.children.length - 1; i >= 0; i--) {
        const child = album.children[i];
        if (child) stack.push(child);
      }
    }
  }
}

/**
 * The id the scanner gives the root album of a media directory: the folder
 * id for Drive sources and the directory path for local ones (see
 * media-scanner.ts and google-drive-service.ts).
 */
function rootAlbumId(directoryPath: string): string {
  return isDrivePath(directoryPath) ? getDriveId(directoryPath) : directoryPath;
}

/** The root albums in `albums` that belong to the given media directories. */
function rootAlbumsOf(
  albums: readonly Album[],
  directoryPaths: readonly string[],
): Album[] {
  const ids = new Set(directoryPaths.map(rootAlbumId));
  const roots: Album[] = [];
  for (const album of albums) {
    if (album && ids.has(album.id)) roots.push(album);
  }
  return roots;
}

/**
 * Prefixes shared by the paths of files inside a local media directory. The
 * scanner builds them with path.join, which normalises separators, so both
 * the stored and the normalised spelling of the directory are included.
 */
function localPathPrefixes(directoryPath: string): string[] {
  const prefixes = new Set<string>();
  prefixes.add(withTrailingSeparator(directoryPath));
  prefixes.add(withTrailingSeparator(path.normalize(directoryPath)));
  return Array.from(prefixes);
}

function withTrailingSeparator(directoryPath: string): string {
  return directoryPath.endsWith(path.sep)
    ? directoryPath
    : directoryPath + path.sep;
}

function getActiveDirectoryPaths(): string[] {
  const rows = getStatement('getActiveDirectoryPaths').all() as {
    path: string;
  }[];
  return rows.map((row) => row.path);
}

/** Reads the album tree cached under `cacheKey`; [] if absent or unreadable. */
function readCachedAlbumTree(cacheKey: string): Album[] {
  const row = getStatement('getCachedAlbum').get(cacheKey) as
    | { cache_value: string }
    | undefined;
  if (!row || !row.cache_value) return [];
  try {
    const parsed: unknown = JSON.parse(row.cache_value);
    return Array.isArray(parsed) ? (parsed as Album[]) : [];
  } catch {
    return [];
  }
}

/**
 * Makes library membership match a completed scan: every member whose file
 * the scan did not return is demoted. The scanner returns no root album for
 * a source it could not read (a Drive folder that failed transiently, an
 * unplugged disk) as well as for an empty one, so the files the previous
 * scan found under such an active source are kept for this scan; if the
 * next scan misses the source again, they are demoted too (and promoted
 * back once a scan finds them). Must run inside a transaction, before the
 * new tree replaces the cached one.
 */
function reconcileLibraryMembership(
  cacheKey: string,
  albums: readonly Album[],
  scannedPaths: readonly string[],
): void {
  const members = new Set(scannedPaths);

  const scannedRootIds = new Set<string>();
  for (const album of albums) {
    if (album) scannedRootIds.add(album.id);
  }
  const unscannedRoots = getActiveDirectoryPaths().filter(
    (dirPath) => !scannedRootIds.has(rootAlbumId(dirPath)),
  );
  if (unscannedRoots.length > 0) {
    forEachAlbumPath(
      rootAlbumsOf(readCachedAlbumTree(cacheKey), unscannedRoots),
      (filePath) => members.add(filePath),
    );
  }

  const rows = getStatement('getLibraryMemberPaths').all() as {
    file_path: string;
  }[];
  const stale: string[] = [];
  for (const row of rows) {
    if (!members.has(row.file_path)) stale.push(row.file_path);
  }
  runBatchedStatement(getStatement('demoteLibraryPathsBatch'), stale);
  if (stale.length > 0) {
    console.log(
      `[worker] ${stale.length} file(s) are no longer in the library.`,
    );
  }
}

/**
 * Demotes the files a media directory provided, for when it is removed or
 * deactivated; files another active source still provides stay members.
 * Drive paths (gdrive://<id>) say nothing about their folder, so a source's
 * files are taken from its root album in the cached library tree. Local
 * files are also matched by path prefix, which covers members the cache no
 * longer lists. Must run inside a transaction.
 */
function demoteSourceMembers(directoryPath: string): void {
  const tree = readCachedAlbumTree(FILE_INDEX_CACHE_KEY);

  const candidates = new Set<string>();
  forEachAlbumPath(rootAlbumsOf(tree, [directoryPath]), (filePath) =>
    candidates.add(filePath),
  );
  if (!isDrivePath(directoryPath)) {
    for (const prefix of localPathPrefixes(directoryPath)) {
      const rows = getStatement('getLibraryMemberPathsWithPrefix').all(
        prefix,
        prefix,
      ) as { file_path: string }[];
      for (const row of rows) candidates.add(row.file_path);
    }
  }
  if (candidates.size === 0) return;

  const otherRoots = getActiveDirectoryPaths().filter(
    (dirPath) => dirPath !== directoryPath,
  );
  const stillProvided = new Set<string>();
  forEachAlbumPath(rootAlbumsOf(tree, otherRoots), (filePath) =>
    stillProvided.add(filePath),
  );
  const otherPrefixes: string[] = [];
  for (const dirPath of otherRoots) {
    if (!isDrivePath(dirPath))
      otherPrefixes.push(...localPathPrefixes(dirPath));
  }

  const stale: string[] = [];
  for (const filePath of candidates) {
    if (stillProvided.has(filePath)) continue;
    if (otherPrefixes.some((prefix) => filePath.startsWith(prefix))) continue;
    stale.push(filePath);
  }
  runBatchedStatement(getStatement('demoteLibraryPathsBatch'), stale);
}

/**
 * Restores membership for the files a re-activated media directory had in
 * the cached library tree (the tree only lists them if the source was
 * active at the last scan). Must run inside a transaction.
 */
function promoteSourceMembers(directoryPath: string): void {
  const paths: string[] = [];
  forEachAlbumPath(
    rootAlbumsOf(readCachedAlbumTree(FILE_INDEX_CACHE_KEY), [directoryPath]),
    (filePath) => paths.push(filePath),
  );
  runBatchedStatement(getStatement('promoteLibraryPathsBatch'), paths);
}

// Core Worker Functions

/**
 * Represents the result of a worker operation.
 */
export interface WorkerResult {
  /** Indicates whether the operation was successful. */
  success: boolean;
  /** The data returned by the operation, if any. */
  data?: unknown;
  /** An error message, if the operation failed. */
  error?: string;
}

/**
 * Initializes the database connection in the worker thread.
 * @param dbPath - The path to the SQLite database file.
 * @returns The result of the initialization.
 */
export function initDatabase(dbPath: string): WorkerResult {
  try {
    if (db) {
      resetConnection();
      console.log('[worker] Closed existing DB connection before re-init.');
    }

    db = new DatabaseSync(dbPath);
    // Wait for locks held by other connections instead of failing at once.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    // Enable WAL mode for better concurrency
    // In node:sqlite, db.exec can run multiple sql statements, including PRAGMAs.
    // db.pragma does not exist in node:sqlite! Use db.exec instead.
    db.exec('PRAGMA journal_mode = WAL');

    initializeDatabase(db);
    db.prepare(
      `UPDATE jobs SET status='pending', updated_at=CURRENT_TIMESTAMP WHERE status='processing'`,
    ).run();

    // Prepare statements for reuse
    statements.recordView = db.prepare(
      `INSERT INTO media_metadata (file_path_hash, file_path, view_count, last_viewed)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET
       view_count = COALESCE(media_metadata.view_count, 0) + 1,
       last_viewed = excluded.last_viewed,
       file_path = COALESCE(excluded.file_path, media_metadata.file_path)`,
    );
    statements.getFileIdByPath = db.prepare(
      `SELECT file_path_hash FROM media_metadata WHERE file_path = ?`,
    );
    statements.getPathByFileId = db.prepare(
      `SELECT file_path FROM media_metadata WHERE file_path_hash = ?`,
    );
    statements.cacheAlbum = db.prepare(
      `INSERT OR REPLACE INTO app_cache (cache_key, cache_value, last_updated) VALUES (?, ?, ?)`,
    );
    statements.getCachedAlbum = db.prepare(
      `SELECT cache_value FROM app_cache WHERE cache_key = ?`,
    );
    statements.addMediaDirectory = db.prepare(`
      INSERT INTO media_directories (id, path, type, name, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(path) DO UPDATE SET is_active = 1, type = excluded.type, name = excluded.name;
    `);
    statements.getMediaDirectories = db.prepare(
      'SELECT id, path, type, name, is_active FROM media_directories',
    );
    statements.getActiveDirectoryPaths = db.prepare(
      'SELECT path FROM media_directories WHERE is_active = 1',
    );
    statements.getMediaDirectoryByPath = db.prepare(
      'SELECT id, is_active FROM media_directories WHERE path = ?',
    );
    statements.removeMediaDirectory = db.prepare(
      'DELETE FROM media_directories WHERE path = ?',
    );
    statements.setDirectoryActiveState = db.prepare(
      'UPDATE media_directories SET is_active = ? WHERE path = ?',
    );
    statements.renameMediaDirectory = db.prepare(
      'UPDATE media_directories SET path = ? WHERE path = ?',
    );
    // Only replaces the placeholder name (the bare Drive ID) older web-mode
    // builds stored, never a name the source already has.
    statements.repairDriveSourceName = db.prepare(
      'UPDATE media_directories SET name = ? WHERE path = ? AND name = ?',
    );
    // Moves every path under one prefix to another (the prefix is bound
    // three times). length()/substr() count characters on both sides, so
    // non-ASCII directory names are handled correctly.
    statements.rewriteMetadataPathPrefix = db.prepare(
      `UPDATE media_metadata SET file_path = ? || substr(file_path, length(?) + 1)
       WHERE substr(file_path, 1, length(?)) = ?`,
    );
    statements.rewriteJobPathPrefix = db.prepare(
      `UPDATE OR IGNORE jobs SET file_path = ? || substr(file_path, length(?) + 1)
       WHERE substr(file_path, 1, length(?)) = ?`,
    );
    statements.deleteCachedAlbum = db.prepare(
      'DELETE FROM app_cache WHERE cache_key = ?',
    );
    // in_library is 1 only for library scans. On conflict membership is
    // never revoked here; only scans and source removal demote rows.
    // A 'failed' result adds one to the consecutive-failure count and a
    // 'success' resets it; both record the attempt time (bound by the caller).
    // Writes without a result status keep both.
    statements.upsertMetadata = db.prepare(
      `INSERT INTO media_metadata (file_path_hash, file_path, duration, size, created_at, rating, extraction_status, playback_position, in_library, extraction_attempts, extraction_attempted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET
       file_path = excluded.file_path,
       duration = COALESCE(excluded.duration, media_metadata.duration),
       size = COALESCE(excluded.size, media_metadata.size),
       created_at = COALESCE(excluded.created_at, media_metadata.created_at),
       rating = COALESCE(excluded.rating, media_metadata.rating),
       extraction_status = COALESCE(excluded.extraction_status, media_metadata.extraction_status),
       playback_position = COALESCE(excluded.playback_position, media_metadata.playback_position),
       in_library = CASE WHEN excluded.in_library = 1 THEN 1 ELSE media_metadata.in_library END,
       extraction_attempts = CASE excluded.extraction_status
         WHEN 'failed' THEN COALESCE(media_metadata.extraction_attempts, 0) + 1
         WHEN 'success' THEN 0
         ELSE media_metadata.extraction_attempts END,
       extraction_attempted_at = CASE
         WHEN excluded.extraction_status IN ('failed', 'success') THEN excluded.extraction_attempted_at
         ELSE media_metadata.extraction_attempted_at END`,
    );
    statements.getLibraryMemberPaths = db.prepare(
      `SELECT DISTINCT file_path FROM media_metadata WHERE in_library = 1 AND file_path IS NOT NULL`,
    );
    statements.getLibraryMemberPathsWithPrefix = db.prepare(
      `SELECT DISTINCT file_path FROM media_metadata WHERE in_library = 1 AND substr(file_path, 1, length(?)) = ?`,
    );
    statements.getPendingMetadata = db.prepare(
      `SELECT file_path FROM media_metadata WHERE (extraction_status = 'pending' OR extraction_status IS NULL) AND file_path IS NOT NULL AND in_library = 1 LIMIT 100`,
    );
    statements.updateRating = db.prepare(
      // Only update rating if the row exists, or insert if capable?
      // For now assume metadata row might not exist, so we use upsert with default values for others if needed.
      // Actually simpler: just update rating if exists, if not insert new row with rating.
      `INSERT INTO media_metadata (file_path_hash, rating) VALUES (?, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET rating = excluded.rating`,
    );
    statements.ensureMetadataRow = db.prepare(
      `INSERT OR IGNORE INTO media_metadata (file_path_hash) VALUES (?)`,
    );
    statements.deleteWatchedSegments = db.prepare(
      `DELETE FROM media_segments WHERE file_path_hash = ? AND type = '${SEGMENT_TYPE_WATCHED}'`,
    );
    statements.insertWatchedSegment = db.prepare(
      `INSERT INTO media_segments (file_path_hash, type, start_time, end_time) VALUES (?, '${SEGMENT_TYPE_WATCHED}', ?, ?)`,
    );
    statements.updatePlaybackPosition = db.prepare(
      `INSERT INTO media_metadata (file_path_hash, playback_position) VALUES (?, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET playback_position = excluded.playback_position`,
    );
    statements.createSmartPlaylist = db.prepare(
      'INSERT INTO smart_playlists (name, criteria) VALUES (?, ?)',
    );
    statements.getSmartPlaylists = db.prepare(
      'SELECT id, name, criteria, createdAt FROM smart_playlists ORDER BY id DESC',
    );
    statements.getRecentlyPlayed = db.prepare(
      `SELECT
        file_path,
        file_path_hash,
        view_count,
        last_viewed,
        duration,
        size,
        rating,
        created_at,
        ${WATCHED_SEGMENTS_JSON} as watched_segments
       FROM media_metadata
       WHERE last_viewed IS NOT NULL
       ORDER BY last_viewed DESC
       LIMIT ?`,
    );
    statements.deleteSmartPlaylist = db.prepare(
      'DELETE FROM smart_playlists WHERE id = ?',
    );
    statements.updateSmartPlaylist = db.prepare(
      'UPDATE smart_playlists SET name = ?, criteria = ? WHERE id = ?',
    );
    statements.saveSetting = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
    );
    statements.getSetting = db.prepare(
      'SELECT value FROM settings WHERE key = ?',
    );
    statements.executeSmartPlaylist = db.prepare(SMART_PLAYLIST_BASE_SELECT);
    statements.addJob = db.prepare(
      `INSERT OR REPLACE INTO jobs (type, file_path, file_path_hash, status, updated_at) VALUES (?, ?, ?, 'pending', CURRENT_TIMESTAMP)`,
    );
    statements.listJobs = db.prepare(
      `SELECT type, file_path, file_path_hash, status, error, created_at, updated_at FROM jobs WHERE type = ? ORDER BY created_at DESC`,
    );
    statements.updateJobStatus = db.prepare(
      `UPDATE jobs SET status=?, error=?, updated_at=CURRENT_TIMESTAMP WHERE type=? AND file_path=?`,
    );
    statements.deleteJob = db.prepare(
      `DELETE FROM jobs WHERE type=? AND file_path=?`,
    );
    statements.getPendingJobs = db.prepare(
      `SELECT file_path FROM jobs WHERE type=? AND status='pending' ORDER BY created_at ASC`,
    );

    // Optimized batch statements
    const placeholders = Array(SQL_BATCH_SIZE).fill('?').join(',');
    statements.getMediaViewCountsBatch = db.prepare(
      `SELECT file_path, view_count FROM media_metadata WHERE file_path IN (${placeholders})`,
    );
    statements.getMetadataBatch = db.prepare(
      `SELECT
        file_path as filePath,
        duration,
        size,
        created_at as createdAt,
        rating,
        extraction_status as status,
        ${WATCHED_SEGMENTS_JSON} as watchedSegments,
        playback_position as playbackPosition
       FROM media_metadata WHERE file_path_hash IN (${placeholders}) AND in_library = 1`,
    );
    // Optimization: Select only necessary columns and alias them to match MediaMetadata interface
    statements.getAllMetadata = db.prepare(
      `SELECT
        file_path as filePath,
        duration,
        size,
        created_at as createdAt,
        rating,
        extraction_status as status,
        ${WATCHED_SEGMENTS_JSON} as watchedSegments,
        playback_position as playbackPosition
       FROM media_metadata WHERE file_path IS NOT NULL AND in_library = 1`,
    );

    // Optimized query for metadata verification (skips rating, watched segments).
    // The duration tells whether a 'success' video row is complete.
    statements.getAllMetadataVerification = db.prepare(
      `SELECT
        file_path as filePath,
        size,
        created_at as createdAt,
        extraction_status as status,
        duration
       FROM media_metadata WHERE file_path IS NOT NULL AND in_library = 1`,
    );

    // Extraction state of finished rows, for filterProcessingNeeded.
    statements.getExtractionStateBatch = db.prepare(
      `SELECT file_path, extraction_status, duration, extraction_attempts, extraction_attempted_at
       FROM media_metadata WHERE file_path IN (${placeholders}) AND extraction_status IN ('success', 'failed')`,
    );

    statements.getFileIdsByPathsBatch = db.prepare(
      `SELECT file_path, file_path_hash FROM media_metadata WHERE file_path IN (${placeholders})`,
    );
    statements.getLibraryPathsBatch = db.prepare(
      `SELECT file_path FROM media_metadata WHERE file_path IN (${placeholders}) AND in_library = 1`,
    );
    statements.demoteLibraryPathsBatch = db.prepare(
      `UPDATE media_metadata SET in_library = 0 WHERE in_library = 1 AND file_path IN (${placeholders})`,
    );
    statements.promoteLibraryPathsBatch = db.prepare(
      `UPDATE media_metadata SET in_library = 1 WHERE file_path IN (${placeholders})`,
    );

    console.log('[worker] SQLite database initialized at:', dbPath);
    return { success: true };
  } catch (error: unknown) {
    console.error('[worker] Failed to initialize database:', error);
    // Release the half-initialised connection: an open handle keeps the
    // database, -wal and -shm files locked (on Windows they cannot even be
    // replaced) and its statements must not outlive it.
    try {
      resetConnection();
    } catch (closeError) {
      console.error(
        '[worker] Failed to close database after init failure:',
        closeError,
      );
    }
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Forgets all prepared statements and closes the connection, if any. The
 * connection is detached before closing, so it is gone even if close()
 * throws.
 */
function resetConnection(): void {
  for (const key of Object.keys(statements) as StatementName[]) {
    delete statements[key];
  }
  const current = db;
  db = null;
  current?.close();
}

interface MetadataPayload {
  filePath: string;
  duration?: number;
  size?: number;
  createdAt?: string; // ISO string
  rating?: number;
  status?: string;
  watchedSegments?: string;
  playbackPosition?: number;
}

/**
 * Replaces the watched segments for a file with the contents of a JSON
 * blob in the legacy {start, end}[] format. Entries without a numeric
 * start are skipped. Throws on malformed JSON.
 */
function replaceWatchedSegments(fileId: string, segmentsJson: string): void {
  let segments: unknown;
  try {
    segments = JSON.parse(segmentsJson);
  } catch {
    throw new Error('Invalid watched segments JSON');
  }
  if (!Array.isArray(segments)) {
    throw new Error('Watched segments must be a JSON array');
  }
  if (segments.length > MAX_WATCHED_SEGMENTS) {
    throw new Error(
      `Too many watched segments (at most ${MAX_WATCHED_SEGMENTS})`,
    );
  }
  getStatement('deleteWatchedSegments').run(fileId);
  for (const seg of segments) {
    const s = seg as { start?: unknown; end?: unknown };
    if (s && typeof s.start === 'number') {
      getStatement('insertWatchedSegment').run(
        fileId,
        s.start,
        typeof s.end === 'number' ? s.end : null,
      );
    }
  }
}

/**
 * Runs the metadata upsert (and segments replacement, when present) for a
 * single payload. Does not manage transactions — callers do.
 * @param markInLibrary - True only for library scans: makes the row a
 *   library member. Otherwise an existing row keeps its membership and a new
 *   row is not a member.
 */
function runMetadataUpsert(
  fileId: string,
  payload: MetadataPayload,
  markInLibrary: boolean,
): void {
  const status = payload.status === undefined ? null : payload.status;
  const isAttempt = status === 'failed' || status === 'success';
  getStatement('upsertMetadata').run(
    fileId,
    payload.filePath,
    payload.duration === undefined ? null : payload.duration,
    payload.size === undefined ? null : payload.size,
    payload.createdAt === undefined ? null : payload.createdAt,
    payload.rating === undefined ? null : payload.rating,
    status,
    payload.playbackPosition === undefined ? null : payload.playbackPosition,
    markInLibrary ? 1 : 0,
    // Used as-is only for a new row; an existing row counts on conflict.
    status === 'failed' ? 1 : 0,
    isAttempt ? Date.now() : null,
  );
  if (
    payload.watchedSegments !== undefined &&
    payload.watchedSegments !== null
  ) {
    replaceWatchedSegments(fileId, payload.watchedSegments);
  }
}

/**
 * Upserts metadata for a file on behalf of a client. This never makes the
 * file a library member: membership (which alone authorizes Drive files) is
 * decided by library scans, see {@link cacheAlbums}.
 */
export async function upsertMetadata(
  payload: MetadataPayload,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const fileId = await getExistingIdOrGenerate(payload.filePath);
    if (
      payload.watchedSegments === undefined ||
      payload.watchedSegments === null
    ) {
      runMetadataUpsert(fileId, payload, false);
    } else {
      // Segment replacement spans multiple statements; keep it atomic.
      db.exec('BEGIN');
      try {
        runMetadataUpsert(fileId, payload, false);
        db.exec('COMMIT');
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackErr) {
          console.error(
            '[worker] Failed to rollback transaction:',
            rollbackErr,
          );
        }
        throw e;
      }
    }
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Updates the rating for a file.
 */
export async function setRating(
  filePath: string,
  rating: number,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const fileId = await getExistingIdOrGenerate(filePath);
    getStatement('updateRating').run(fileId, rating);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Updates watched segments for a file.
 */
export async function updateWatchedSegments(
  filePath: string,
  segmentsJson: string,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const fileId = await getExistingIdOrGenerate(filePath);
    db.exec('BEGIN');
    try {
      // Keep a metadata row around so the file's ID stays stable even when
      // only segments are known for it.
      getStatement('ensureMetadataRow').run(fileId);
      replaceWatchedSegments(fileId, segmentsJson);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[worker] Failed to rollback transaction:', rollbackErr);
      }
      throw e;
    }
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Updates the last-known playback position for a file. Used to power
 * resume-on-replay in the renderer.
 */
export async function updatePlaybackPosition(
  filePath: string,
  position: number,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const fileId = await getExistingIdOrGenerate(filePath);
    getStatement('updatePlaybackPosition').run(
      fileId,
      Number.isFinite(position) ? Math.max(0, position) : 0,
    );
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/** A bulk-upsert payload paired with the file ID its row is keyed on. */
type PreparedUpsert = MetadataPayload & { fileId: string };

/**
 * Resolves the rows a bulk upsert has to write, paired with their file IDs.
 * ID generation may stat files, so this runs before (never inside) the
 * write transaction. Throws if an ID cannot be generated.
 * @param markInLibrary - Whether the upsert confirms library membership (a
 *   scan). Path-only payloads are then skipped only for rows that already
 *   are members, so existing non-member rows are promoted.
 */
async function prepareBulkUpsert(
  payloads: MetadataPayload[],
  markInLibrary: boolean,
): Promise<PreparedUpsert[]> {
  // Filter out payloads that are just "path confirmation" (no new data)
  // and already exist in the database. This avoids thousands of redundant INSERT ... ON CONFLICT calls.
  const pathOnlyPayloads: MetadataPayload[] = [];
  const updatePayloads: MetadataPayload[] = [];

  for (const p of payloads) {
    // Check if any property in metadata is defined without rest destructuring or Object.values
    let hasData = false;
    for (const key in p) {
      if (
        Object.hasOwn(p, key) &&
        key !== 'filePath' &&
        (p as unknown as Record<string, unknown>)[key] !== undefined
      ) {
        hasData = true;
        break;
      }
    }

    if (hasData) {
      updatePayloads.push(p);
    } else {
      pathOnlyPayloads.push(p);
    }
  }

  const payloadsToProcess = updatePayloads.slice();

  if (pathOnlyPayloads.length > 0) {
    const paths = pathOnlyPayloads.map((p) => p.filePath);
    const existingPaths = getExistingPathsBatch(paths, markInLibrary);

    // Use manual loop instead of Array.prototype.filter and spread operator to avoid allocation overhead and call stack limits
    for (const p of pathOnlyPayloads) {
      if (!existingPaths.has(p.filePath)) {
        payloadsToProcess.push(p);
      }
    }
  }

  if (payloadsToProcess.length === 0) {
    return [];
  }

  const idMap = await generateFileIdsBatched(
    payloadsToProcess.map((p) => p.filePath),
  );

  // Map payloads to include fileId, failing if any ID is missing
  return payloadsToProcess.map((p) => {
    const fileId = idMap.get(p.filePath);
    if (!fileId) {
      throw new Error(`Failed to generate ID for path: ${p.filePath}`);
    }
    return Object.assign({ fileId }, p);
  });
}

/** Writes prepared upserts. Does not manage transactions — callers do. */
function writePreparedUpserts(
  items: PreparedUpsert[],
  markInLibrary: boolean,
): void {
  for (const item of items) {
    runMetadataUpsert(item.fileId, item, markInLibrary);
  }
}

/**
 * Bulk upserts metadata for multiple files (metadata extraction). Like
 * {@link upsertMetadata} this leaves library membership to scans unless
 * `markInLibrary` is set.
 */
export async function bulkUpsertMetadata(
  payloads: MetadataPayload[],
  { markInLibrary = false }: { markInLibrary?: boolean } = {},
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const items = await prepareBulkUpsert(payloads, markInLibrary);
    if (items.length > 0) {
      runInTransaction(() => writePreparedUpserts(items, markInLibrary));
    }
    return { success: true };
  } catch (error: unknown) {
    console.error('[worker] Bulk metadata upsert failed:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves metadata for all files.
 */
export function getAllMetadata(): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = getStatement('getAllMetadata').all() as {
      filePath: string;
      [key: string]: unknown;
    }[];

    const metadataMap: { [key: string]: unknown } = {};
    for (const row of rows) {
      if (row.filePath) {
        metadataMap[row.filePath] = row;
      }
    }

    return { success: true, data: metadataMap };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves lightweight metadata for verification checks.
 * Skips heavy columns like watched segments and rating.
 */
export function getAllMetadataVerification(): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = getStatement('getAllMetadataVerification').all() as {
      filePath: string;
      size: number;
      createdAt: string;
      status: string;
      duration: number | null;
    }[];

    // Return raw rows to avoid blocking worker with heavy transformation.
    // The transformation to a map will be handled by the consumer.
    return { success: true, data: rows };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Filters a list of file paths to only those that need metadata processing.
 * Removes paths whose metadata is complete (marked 'success' and, for a
 * video, stored with a duration) and paths whose extraction failed recently
 * enough to still be backing off, so files that never yield metadata are not
 * probed on every scan. Explicit client requests (forceCheck) don't use this
 * filter and still probe them.
 * @param filePaths - The list of file paths to check.
 * @returns The filtered list of file paths.
 */
export async function filterProcessingNeeded(
  filePaths: string[],
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    if (filePaths.length === 0) {
      return { success: true, data: [] };
    }

    const successfulPathsSet = new Set<string>();
    const now = Date.now();

    forEachBatchedRow<{
      file_path: string;
      extraction_status: string;
      duration: number | null;
      extraction_attempts: number | null;
      extraction_attempted_at: number | null;
    }>(getStatement('getExtractionStateBatch'), filePaths, (row) => {
      // Older versions stored videos whose duration probe failed as
      // 'success' with a NULL duration; those still need extraction.
      if (
        isMetadataComplete(
          row.file_path,
          row.extraction_status,
          row.duration,
        ) ||
        isExtractionBackedOff(
          row.extraction_status,
          row.extraction_attempts,
          row.extraction_attempted_at,
          now,
        )
      ) {
        successfulPathsSet.add(row.file_path);
      }
    });

    const neededPaths: string[] = [];
    for (const p of filePaths) {
      if (!successfulPathsSet.has(p)) {
        neededPaths.push(p);
      }
    }
    return { success: true, data: neededPaths };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves metadata for a list of files.
 */
export async function getMetadata(filePaths: string[]): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    if (filePaths.length === 0) {
      return { success: true, data: {} };
    }

    const idMap = await generateFileIdsBatched(filePaths);
    const allFileIds = Array.from(new Set(idMap.values()));

    const metadataMap: { [key: string]: unknown } = {};

    forEachBatchedRow<{ filePath: string; [key: string]: unknown }>(
      getStatement('getMetadataBatch'),
      allFileIds,
      (row) => {
        if (row && row.filePath) {
          metadataMap[row.filePath] = row;
        }
      },
    );

    return { success: true, data: metadataMap };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

// Smart Playlist Functions

/**
 * Creates a new smart playlist.
 */
export function createSmartPlaylist(
  name: string,
  criteria: string,
): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const result = getStatement('createSmartPlaylist').run(name, criteria);
    return { success: true, data: { id: result.lastInsertRowid } };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves all smart playlists.
 */
export function getSmartPlaylists(): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const playlists = getStatement('getSmartPlaylists').all();
    return { success: true, data: playlists };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Deletes a smart playlist.
 */
export function deleteSmartPlaylist(id: number): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    getStatement('deleteSmartPlaylist').run(id);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Updates a smart playlist.
 */
export function updateSmartPlaylist(
  id: number,
  name: string,
  criteria: string,
): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    getStatement('updateSmartPlaylist').run(name, criteria, id);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves recently played media items.
 * @param limit - The maximum number of items to return.
 */
export function getRecentlyPlayed(limit: number): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = getStatement('getRecentlyPlayed').all(limit);
    return { success: true, data: rows };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Saves a setting (key-value pair) to the database.
 */
export function saveSetting(key: string, value: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    getStatement('saveSetting').run(key, value, new Date().toISOString());
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves a setting value from the database.
 */
export function getSetting(key: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const row = getStatement('getSetting').get(key) as
      | { value: string }
      | undefined;
    return { success: true, data: row ? row.value : null };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/** Parsed smart playlist criteria; each field is validated before use. */
interface SmartPlaylistCriteria {
  minRating?: unknown;
  minDuration?: unknown;
  minViews?: unknown;
  maxViews?: unknown;
  minDaysSinceView?: unknown;
}

/**
 * Executes a smart playlist criteria to find matching files.
 */
export function executeSmartPlaylist(criteriaJson?: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    // Use cached prepared statement for empty criteria
    // This avoids recompiling the SQL statement for the default "view all" case
    if (!criteriaJson || criteriaJson === '{}') {
      const rows = getStatement('executeSmartPlaylist').all();
      return { success: true, data: rows };
    }

    let sql = SMART_PLAYLIST_BASE_SELECT;
    const params: (number | string)[] = [];

    if (criteriaJson && criteriaJson !== '{}') {
      try {
        const criteria = JSON.parse(criteriaJson) as SmartPlaylistCriteria;

        if (typeof criteria.minRating === 'number') {
          sql += ' AND rating >= ?';
          params.push(criteria.minRating);
        }
        if (typeof criteria.minDuration === 'number') {
          sql += ' AND duration >= ?';
          params.push(criteria.minDuration);
        }
        if (typeof criteria.minViews === 'number') {
          sql += ' AND COALESCE(view_count, 0) >= ?';
          params.push(criteria.minViews);
        }
        if (typeof criteria.maxViews === 'number') {
          sql += ' AND COALESCE(view_count, 0) <= ?';
          params.push(criteria.maxViews);
        }
        if (typeof criteria.minDaysSinceView === 'number') {
          // Logic: item matches if (now - last_viewed) >= minDays OR last_viewed is NULL
          sql +=
            " AND (last_viewed IS NULL OR (julianday('now') - julianday(last_viewed)) >= ?)";
          params.push(criteria.minDaysSinceView);
        }
      } catch (e) {
        console.error('[worker] Invalid criteria JSON:', criteriaJson, e);
        throw e;
      }
    }

    // Filter in SQL instead of fetching all rows
    const stmt = db.prepare(sql);
    const rows = stmt.all(...params);
    return { success: true, data: rows };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Records a view for a media file.
 * Views recorded for files the library scan has not indexed create a
 * stats-only row (in_library = 0), which keeps them out of smart playlists
 * while preserving their view history.
 * @param filePath - The path of the file that was viewed.
 * @returns The result of the operation.
 */
export async function recordMediaView(filePath: string): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };

  try {
    const fileId = await getExistingIdOrGenerate(filePath);
    const now = new Date().toISOString();
    getStatement('recordView').run(fileId, filePath, now);
    return { success: true };
  } catch (error: unknown) {
    console.error(`[worker] Error recording view for ${filePath}:`, error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Gets view counts for multiple file paths.
 * @param filePaths - An array of file paths.
 * @returns The result including the view count map.
 */
export async function getMediaViewCounts(
  filePaths: string[],
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  if (!filePaths || filePaths.length === 0) {
    return { success: true, data: {} };
  }

  try {
    const viewCountsMap: { [key: string]: number } = {};

    // Optimization: Direct path lookup instead of fs.stat -> hash -> lookup.
    // This assumes paths in DB are kept up-to-date by recordMediaView.
    forEachBatchedRow<{ file_path: string; view_count: number }>(
      getStatement('getMediaViewCountsBatch'),
      filePaths,
      (row) => {
        viewCountsMap[row.file_path] = row.view_count;
      },
    );

    // Fill in 0 for paths not found
    for (const filePath of filePaths) {
      if (viewCountsMap[filePath] === undefined) {
        viewCountsMap[filePath] = 0;
      }
    }

    return { success: true, data: viewCountsMap };
  } catch (error: unknown) {
    console.error('[worker] Error fetching view counts:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Caches the album tree of a completed library scan and makes library
 * membership (in_library, the whitelist for Drive & Local) match it: every
 * scanned file becomes a member, and members the scan no longer found are
 * demoted (see {@link reconcileLibraryMembership}). Both happen in one
 * transaction with the cache write, so the cached tree never lists files
 * that are not authorized, and a failed write reports failure. Only the
 * root albums of sources that are active when the result is written are
 * kept: a source removed or deactivated while the scan ran stays out.
 * @param cacheKey - The key to use for caching.
 * @param albums - The album data to cache.
 * @returns The result of the operation.
 */
export async function cacheAlbums(
  cacheKey: string,
  albums: unknown,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const scannedAlbums = Array.isArray(albums) ? (albums as Album[]) : null;
    const scannedPaths: string[] = [];
    if (scannedAlbums) {
      forEachAlbumPath(scannedAlbums, (filePath) =>
        scannedPaths.push(filePath),
      );
    }

    // We pass only filePath; existing metadata (duration, etc.) is preserved by upsert logic.
    const upserts = await prepareBulkUpsert(
      scannedPaths.map((p) => ({ filePath: p })),
      true,
    );

    // The sources can change while the IDs are prepared (and while the scan
    // ran), so the active ones are read in the write transaction.
    runInTransaction(() => {
      let cached: unknown = albums;
      if (scannedAlbums) {
        const roots = rootAlbumsOf(scannedAlbums, getActiveDirectoryPaths());
        const paths: string[] = [];
        forEachAlbumPath(roots, (filePath) => paths.push(filePath));
        const kept = new Set(paths);
        writePreparedUpserts(
          upserts.filter((item) => kept.has(item.filePath)),
          true,
        );
        reconcileLibraryMembership(cacheKey, roots, paths);
        cached = roots;
      }
      getStatement('cacheAlbum').run(
        cacheKey,
        JSON.stringify(cached),
        new Date().toISOString(),
      );
    });
    return { success: true };
  } catch (error: unknown) {
    console.error('[worker] Error caching albums:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves cached albums from the database.
 * @param cacheKey - The key of the cache to retrieve.
 * @returns The result including the cached data.
 */
export function getCachedAlbums(cacheKey: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const row = getStatement('getCachedAlbum').get(cacheKey) as
      | { cache_value: string }
      | undefined;
    const data: unknown =
      row && row.cache_value ? JSON.parse(row.cache_value) : null;
    return { success: true, data };
  } catch (error: unknown) {
    console.error('[worker] Error reading cached albums:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Closes the database connection.
 * @returns The result of the operation.
 */
export function closeDatabase(): WorkerResult {
  if (!db) return { success: true };
  try {
    resetConnection();
    console.log('[worker] Database connection closed.');
    return { success: true };
  } catch (error: unknown) {
    console.error('[worker] Error closing database:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Adds a new media directory path to the database.
 * @param payload - The directory object to add.
 * @returns The result of the operation.
 */
export function addMediaDirectory(payload: {
  id?: string;
  path: string;
  type?: string;
  name?: string;
}): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const id = payload.id || crypto.randomUUID();
    // The gdrive:// prefix is what scanning and authorization key off, so it
    // decides the type even when a caller only passes the path.
    const type = isDrivePath(payload.path)
      ? 'google_drive'
      : payload.type || 'local';
    const name = payload.name || path.basename(payload.path) || payload.path;

    getStatement('addMediaDirectory').run(id, payload.path, type, name);
    return { success: true };
  } catch (error: unknown) {
    console.error(
      `[worker] Error adding media directory ${payload.path}:`,
      error,
    );
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Retrieves all media directory paths from the database.
 * @returns The result including the list of directories.
 */
export function getMediaDirectories(): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = getStatement('getMediaDirectories').all() as {
      id: string;
      path: string;
      type: string;
      name: string;
      is_active: number;
    }[];
    const directories = rows.map((row) => ({
      id: row.id,
      path: row.path,
      // Older web-mode builds stored Drive sources as 'local'.
      type: isDrivePath(row.path)
        ? 'google_drive'
        : (row.type as 'local' | 'google_drive'),
      name: row.name,
      isActive: !!row.is_active,
    }));
    return { success: true, data: directories };
  } catch (error: unknown) {
    console.error('[worker] Error fetching media directories:', error);
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Gives a Drive source stored by an older web-mode build, whose name is
 * still its bare folder ID, the folder's real name. Sources with any other
 * name (and local sources) are left alone.
 * @param directoryPath - The source's gdrive://<id> path.
 * @param name - The Drive folder's name.
 * @returns The result; `data` is whether the row was renamed.
 */
export function repairDriveSourceName(
  directoryPath: string,
  name: string,
): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  if (!isDrivePath(directoryPath) || !name) {
    return { success: true, data: false };
  }
  try {
    const { changes } = getStatement('repairDriveSourceName').run(
      name,
      directoryPath,
      getDriveId(directoryPath),
    );
    return { success: true, data: Number(changes) > 0 };
  } catch (error: unknown) {
    console.error(
      `[worker] Error renaming media directory ${directoryPath}:`,
      error,
    );
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Removes a media directory path from the database, together with the
 * library membership of the files only it provided.
 * @param directoryPath - The path of the directory to remove.
 * @returns The result of the operation.
 */
export function removeMediaDirectory(directoryPath: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    runInTransaction(() => {
      demoteSourceMembers(directoryPath);
      getStatement('removeMediaDirectory').run(directoryPath);
    });
    return { success: true };
  } catch (error: unknown) {
    console.error(
      `[worker] Error removing media directory ${directoryPath}:`,
      error,
    );
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Updates the active state of a media directory. Deactivating demotes the
 * files only it provided; re-activating restores the members it had in the
 * cached library tree.
 * @param directoryPath - The path of the directory to update.
 * @param isActive - The new active state.
 * @returns The result of the operation.
 */
export function setDirectoryActiveState(
  directoryPath: string,
  isActive: boolean,
): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    runInTransaction(() => {
      if (isActive) {
        promoteSourceMembers(directoryPath);
      } else {
        demoteSourceMembers(directoryPath);
      }
      getStatement('setDirectoryActiveState').run(
        isActive ? 1 : 0,
        directoryPath,
      );
    });
    return { success: true };
  } catch (error: unknown) {
    console.error(
      `[worker] Error updating active state for ${directoryPath}:`,
      error,
    );
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Rewrites a legacy media directory row to its canonical (symlink-free)
 * path, moving the stored paths of its files along with it, so that
 * authorization no longer follows a link that could be retargeted. When the
 * canonical path already is a source of its own, the legacy row is only
 * deactivated (it is never deleted). The cached library tree is dropped in
 * both cases so the next load rescans with canonical paths. Idempotent: a
 * legacy row that is gone or already an inactive alias is left alone, and
 * the cache is kept.
 * @param directoryPath - The stored path of the directory.
 * @param canonicalPath - Its resolved real path.
 * @returns The result of the operation.
 */
export function canonicalizeMediaDirectory(
  directoryPath: string,
  canonicalPath: string,
): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    runInTransaction(() => {
      const legacy = getStatement('getMediaDirectoryByPath').get(
        directoryPath,
      ) as { is_active: number } | undefined;
      if (!legacy || directoryPath === canonicalPath) return;
      if (getStatement('getMediaDirectoryByPath').get(canonicalPath)) {
        if (!legacy.is_active) return;
        demoteSourceMembers(directoryPath);
        getStatement('setDirectoryActiveState').run(0, directoryPath);
      } else {
        getStatement('renameMediaDirectory').run(canonicalPath, directoryPath);
        const newPrefix = withTrailingSeparator(canonicalPath);
        for (const oldPrefix of localPathPrefixes(directoryPath)) {
          if (oldPrefix === newPrefix) continue;
          const args = [newPrefix, oldPrefix, oldPrefix, oldPrefix];
          getStatement('rewriteMetadataPathPrefix').run(...args);
          getStatement('rewriteJobPathPrefix').run(...args);
        }
      }
      getStatement('deleteCachedAlbum').run(FILE_INDEX_CACHE_KEY);
    });
    return { success: true };
  } catch (error: unknown) {
    console.error(
      `[worker] Error canonicalizing media directory ${directoryPath}:`,
      error,
    );
    return { success: false, error: (error as Error).message };
  }
}

// Generic background-job functions. Jobs are keyed on (type, file_path);
// the transcode queue uses JOB_TYPE_TRANSCODE, and future pipelines
// (thumbnails, previews, hashing) can add their own types.

export async function addJob(
  jobType: string,
  filePath: string,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const fileId = await getExistingIdOrGenerate(filePath);
    getStatement('addJob').run(jobType, filePath, fileId);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export function listJobs(jobType: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = getStatement('listJobs').all(jobType);
    return { success: true, data: rows };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export function updateJobStatus(
  jobType: string,
  filePath: string,
  status: string,
  error: string | null,
): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    getStatement('updateJobStatus').run(status, error, jobType, filePath);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

export function deleteJob(jobType: string, filePath: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    getStatement('deleteJob').run(jobType, filePath);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export function getPendingJobs(jobType: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = getStatement('getPendingJobs').all(jobType) as {
      file_path: string;
    }[];
    return { success: true, data: rows.map((r) => r.file_path) };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

type FilePathPayload = { filePath: string };
type JobPayload = { jobType: string; filePath: string };
type JobStatusPayload = {
  filePath: string;
  status: string;
  error?: string | null;
};

/** A request sent by the main thread; `type` selects the handler below. */
type WorkerRequest = { id: number } & (
  | { type: 'init'; payload: { dbPath: string } }
  | { type: 'recordMediaView'; payload: FilePathPayload }
  | { type: 'getMediaViewCounts'; payload: { filePaths: string[] } }
  | { type: 'cacheAlbums'; payload: { cacheKey: string; albums: unknown } }
  | { type: 'getCachedAlbums'; payload: { cacheKey: string } }
  | { type: 'close'; payload?: undefined }
  | {
      type: 'addMediaDirectory';
      payload: { directoryObj: Parameters<typeof addMediaDirectory>[0] };
    }
  | { type: 'getMediaDirectories'; payload?: undefined }
  | { type: 'removeMediaDirectory'; payload: { directoryPath: string } }
  | {
      type: 'repairDriveSourceName';
      payload: { directoryPath: string; name: string };
    }
  | {
      type: 'setDirectoryActiveState';
      payload: { directoryPath: string; isActive: boolean };
    }
  | {
      type: 'canonicalizeMediaDirectory';
      payload: { directoryPath: string; canonicalPath: string };
    }
  | { type: 'upsertMetadata'; payload: MetadataPayload }
  | { type: 'bulkUpsertMetadata'; payload: MetadataPayload[] }
  | { type: 'setRating'; payload: { filePath: string; rating: number } }
  | {
      type: 'updateWatchedSegments';
      payload: { filePath: string; segmentsJson: string };
    }
  | {
      type: 'updatePlaybackPosition';
      payload: { filePath: string; position: number };
    }
  | { type: 'getAllMetadata'; payload?: undefined }
  | { type: 'getAllMetadataVerification'; payload?: undefined }
  | { type: 'getMetadata'; payload: { filePaths: string[] } }
  | { type: 'createSmartPlaylist'; payload: { name: string; criteria: string } }
  | { type: 'getSmartPlaylists'; payload?: undefined }
  | { type: 'deleteSmartPlaylist'; payload: { id: number } }
  | {
      type: 'updateSmartPlaylist';
      payload: { id: number; name: string; criteria: string };
    }
  | { type: 'saveSetting'; payload: { key: string; value: string } }
  | { type: 'getSetting'; payload: { key: string } }
  | { type: 'executeSmartPlaylist'; payload: { criteria?: string } }
  | { type: 'getRecentlyPlayed'; payload: { limit: number } }
  | { type: 'getPendingMetadata'; payload?: undefined }
  | { type: 'filterProcessingNeeded'; payload: { filePaths: string[] } }
  | { type: 'addTranscodeJob'; payload: FilePathPayload }
  | { type: 'listTranscodeJobs'; payload?: undefined }
  | { type: 'updateTranscodeJobStatus'; payload: JobStatusPayload }
  | { type: 'deleteTranscodeJob'; payload: FilePathPayload }
  | { type: 'getPendingTranscodeJobs'; payload?: undefined }
  | { type: 'addJob'; payload: JobPayload }
  | { type: 'listJobs'; payload: { jobType: string } }
  | { type: 'updateJobStatus'; payload: JobPayload & JobStatusPayload }
  | { type: 'deleteJob'; payload: JobPayload }
  | { type: 'getPendingJobs'; payload: { jobType: string } }
);

if (parentPort) {
  /**
   * Listen for messages from the main thread.
   */
  const handleMessage = async (rawMessage: unknown): Promise<void> => {
    // Messages cross a thread boundary untyped; WorkerRequest describes what
    // the main thread sends (see worker-client.ts / database.ts).
    const message = rawMessage as WorkerRequest;
    const { id } = message;
    let result: WorkerResult;

    try {
      switch (message.type) {
        case 'init':
          result = initDatabase(message.payload.dbPath);
          break;
        case 'recordMediaView':
          result = await recordMediaView(message.payload.filePath);
          break;
        case 'getMediaViewCounts':
          result = await getMediaViewCounts(message.payload.filePaths);
          break;
        case 'cacheAlbums':
          result = await cacheAlbums(
            message.payload.cacheKey,
            message.payload.albums,
          );
          break;
        case 'getCachedAlbums':
          result = getCachedAlbums(message.payload.cacheKey);
          break;
        case 'close':
          result = closeDatabase();
          break;
        case 'addMediaDirectory':
          // Accepts simple string or object now
          result = addMediaDirectory(message.payload.directoryObj);
          break;
        case 'getMediaDirectories':
          result = getMediaDirectories();
          break;
        case 'removeMediaDirectory':
          result = removeMediaDirectory(message.payload.directoryPath);
          break;
        case 'repairDriveSourceName':
          result = repairDriveSourceName(
            message.payload.directoryPath,
            message.payload.name,
          );
          break;
        case 'setDirectoryActiveState':
          result = setDirectoryActiveState(
            message.payload.directoryPath,
            message.payload.isActive,
          );
          break;
        case 'canonicalizeMediaDirectory':
          result = canonicalizeMediaDirectory(
            message.payload.directoryPath,
            message.payload.canonicalPath,
          );
          break;
        case 'upsertMetadata':
          result = await upsertMetadata(message.payload);
          break;
        case 'bulkUpsertMetadata':
          result = await bulkUpsertMetadata(message.payload);
          break;
        case 'setRating':
          result = await setRating(
            message.payload.filePath,
            message.payload.rating,
          );
          break;
        case 'updateWatchedSegments':
          result = await updateWatchedSegments(
            message.payload.filePath,
            message.payload.segmentsJson,
          );
          break;
        case 'updatePlaybackPosition':
          result = await updatePlaybackPosition(
            message.payload.filePath,
            message.payload.position,
          );
          break;
        case 'getAllMetadata':
          result = getAllMetadata();
          break;
        case 'getAllMetadataVerification':
          result = getAllMetadataVerification();
          break;
        case 'getMetadata':
          result = await getMetadata(message.payload.filePaths);
          break;
        case 'createSmartPlaylist':
          result = createSmartPlaylist(
            message.payload.name,
            message.payload.criteria,
          );
          break;
        case 'getSmartPlaylists':
          result = getSmartPlaylists();
          break;
        case 'deleteSmartPlaylist':
          result = deleteSmartPlaylist(message.payload.id);
          break;
        case 'updateSmartPlaylist':
          result = updateSmartPlaylist(
            message.payload.id,
            message.payload.name,
            message.payload.criteria,
          );
          break;
        case 'saveSetting':
          result = saveSetting(message.payload.key, message.payload.value);
          break;
        case 'getSetting':
          result = getSetting(message.payload.key);
          break;
        case 'executeSmartPlaylist':
          result = executeSmartPlaylist(message.payload.criteria);
          break;
        case 'getRecentlyPlayed':
          result = getRecentlyPlayed(message.payload.limit);
          break;
        case 'getPendingMetadata': {
          if (!db) {
            result = { success: false, error: 'DB not ready' };
            break;
          }
          const pending = getStatement('getPendingMetadata').all() as {
            file_path: string;
          }[];
          result = { success: true, data: pending.map((p) => p.file_path) };
          break;
        }
        case 'filterProcessingNeeded':
          result = await filterProcessingNeeded(message.payload.filePaths);
          break;
        case 'addTranscodeJob':
          result = await addJob(JOB_TYPE_TRANSCODE, message.payload.filePath);
          break;
        case 'listTranscodeJobs':
          result = listJobs(JOB_TYPE_TRANSCODE);
          break;
        case 'updateTranscodeJobStatus':
          result = updateJobStatus(
            JOB_TYPE_TRANSCODE,
            message.payload.filePath,
            message.payload.status,
            message.payload.error ?? null,
          );
          break;
        case 'deleteTranscodeJob':
          result = deleteJob(JOB_TYPE_TRANSCODE, message.payload.filePath);
          break;
        case 'getPendingTranscodeJobs':
          result = getPendingJobs(JOB_TYPE_TRANSCODE);
          break;
        case 'addJob':
          result = await addJob(
            message.payload.jobType,
            message.payload.filePath,
          );
          break;
        case 'listJobs':
          result = listJobs(message.payload.jobType);
          break;
        case 'updateJobStatus':
          result = updateJobStatus(
            message.payload.jobType,
            message.payload.filePath,
            message.payload.status,
            message.payload.error ?? null,
          );
          break;
        case 'deleteJob':
          result = deleteJob(message.payload.jobType, message.payload.filePath);
          break;
        case 'getPendingJobs':
          result = getPendingJobs(message.payload.jobType);
          break;
        default:
          result = {
            success: false,
            error: `Unknown message type: ${String((message as { type: unknown }).type)}`,
          };
      }
    } catch (error: unknown) {
      console.error(
        `[worker] Error processing message id=${id}, type=${message.type}:`,
        error,
      );
      result = { success: false, error: (error as Error).message };
    }

    parentPort!.postMessage({ id, result });
  };

  parentPort.on('message', (rawMessage: unknown) => {
    void handleMessage(rawMessage);
  });

  console.log('[database-worker.js] Worker thread started and ready.');
  parentPort.postMessage({ type: 'ready' });
}
