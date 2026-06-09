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
import { generateFileId } from '../media/utils/file-id.ts';
import {
  initializeDatabase,
  JOB_TYPE_TRANSCODE,
  SEGMENT_TYPE_WATCHED,
} from './database-schema.ts';

// Extract the Statement type from return value of DatabaseSync.prepare or mock it
type StatementSync = ReturnType<DatabaseSync['prepare']>;

/**
 * The database instance for this worker thread.
 */
let db: DatabaseSync | null = null;

/**
 * Cache for prepared statements to improve performance of repeated queries.
 * Keys are the statement names (e.g., 'recordView'), and values are the prepared SQLite statements.
 */
const statements: { [key: string]: StatementSync } = {};

/**
 * Default batch size for SQL operations.
 * 900 is chosen to be safely within SQLite's default limit of 999 parameters.
 */
const SQL_BATCH_SIZE = 900;

/**
 * Correlated subquery that reassembles watched segments for the current
 * media_metadata row into the legacy JSON format ({start, end}[]), or NULL
 * when the file has no watched segments. Keeps the worker's message
 * contract unchanged while segments live in the media_segments table.
 */
const WATCHED_SEGMENTS_JSON = `NULLIF((SELECT json_group_array(json_object('start', s.start_time, 'end', s.end_time) ORDER BY s.start_time) FROM media_segments s WHERE s.file_path_hash = media_metadata.file_path_hash AND s.type = '${SEGMENT_TYPE_WATCHED}'), '[]')`;

// Helper Functions

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
  // Use SQL_BATCH_SIZE (900) for DB queries
  if (db && statements.getFileIdsByPathsBatch) {
    for (let i = 0; i < filePaths.length; i += SQL_BATCH_SIZE) {
      const batchPaths = filePaths.slice(i, i + SQL_BATCH_SIZE);
      let rows: { file_path: string; file_path_hash: string }[];

      try {
        if (batchPaths.length === SQL_BATCH_SIZE) {
          rows = statements.getFileIdsByPathsBatch.all(...batchPaths) as {
            file_path: string;
            file_path_hash: string;
          }[];
        } else {
          // Pad with nulls for cached statement
          const args = new Array(SQL_BATCH_SIZE).fill(null);
          for (let k = 0; k < batchPaths.length; k++) {
            args[k] = batchPaths[k];
          }
          rows = statements.getFileIdsByPathsBatch.all(...args) as {
            file_path: string;
            file_path_hash: string;
          }[];
        }

        for (const row of rows) {
          if (row.file_path) {
            pathIdMap.set(row.file_path, row.file_path_hash);
          }
        }
      } catch (err) {
        console.warn(
          '[worker] Failed to query existing file IDs (falling back to generation):',
          err,
        );
      }
    }
  }

  // 2. Identify missing paths
  // Bolt Optimization: Use manual loop instead of Array.prototype.filter to avoid allocation overhead
  const missingPaths: string[] = [];
  for (const p of filePaths) {
    if (!pathIdMap.has(p)) {
      missingPaths.push(p);
    }
  }

  // 3. Process missing paths with fs.stat (limited concurrency)
  const IO_BATCH_SIZE = 50;
  for (let i = 0; i < missingPaths.length; i += IO_BATCH_SIZE) {
    const batch = missingPaths.slice(i, i + IO_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (filePath) => {
        const fileId = await generateFileId(filePath);
        return { filePath, fileId };
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { filePath, fileId } = result.value;
        pathIdMap.set(filePath, fileId);
      }
    }
  }
  return pathIdMap;
}

/**
 * Helper to get an existing file ID from the database or generate one if not found.
 * Checks media_metadata first, then falls back to generation (fs.stat).
 */
async function getExistingIdOrGenerate(filePath: string): Promise<string> {
  try {
    const row = statements.getFileIdByPath.get(filePath) as
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

  return generateFileId(filePath);
}

/**
 * Helper to check which paths already exist in the database.
 * @param filePaths - List of file paths to check.
 * @returns Set of file paths that exist.
 */
function getExistingPathsBatch(filePaths: string[]): Set<string> {
  const existingPaths = new Set<string>();
  if (!db || !statements.getFileIdsByPathsBatch) return existingPaths;

  for (let i = 0; i < filePaths.length; i += SQL_BATCH_SIZE) {
    const batchPaths = filePaths.slice(i, i + SQL_BATCH_SIZE);
    if (batchPaths.length === 0) continue;

    let rows: { file_path: string; file_path_hash: string }[];
    try {
      const args = new Array(SQL_BATCH_SIZE).fill(null);
      for (let k = 0; k < batchPaths.length; k++) {
        args[k] = batchPaths[k];
      }
      rows = statements.getFileIdsByPathsBatch.all(...args) as {
        file_path: string;
        file_path_hash: string;
      }[];

      for (const row of rows) {
        if (row.file_path) {
          existingPaths.add(row.file_path);
        }
      }
    } catch (err) {
      console.warn('[worker] Error checking existing paths:', err);
    }
  }
  return existingPaths;
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
      db.close();
      console.log('[worker] Closed existing DB connection before re-init.');
    }

    db = new DatabaseSync(dbPath);
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
    statements.cacheAlbum = db.prepare(
      `INSERT OR REPLACE INTO app_cache (cache_key, cache_value, last_updated) VALUES (?, ?, ?)`,
    );
    statements.getCachedAlbum = db.prepare(
      `SELECT cache_value FROM app_cache WHERE cache_key = ?`,
    );
    statements.addMediaDirectory = db.prepare(`
      INSERT INTO media_directories (id, path, type, name, is_active)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(path) DO UPDATE SET is_active = 1;
    `);
    statements.getMediaDirectories = db.prepare(
      'SELECT id, path, type, name, is_active FROM media_directories',
    );
    statements.removeMediaDirectory = db.prepare(
      'DELETE FROM media_directories WHERE path = ?',
    );
    statements.setDirectoryActiveState = db.prepare(
      'UPDATE media_directories SET is_active = ? WHERE path = ?',
    );
    statements.upsertMetadata = db.prepare(
      `INSERT INTO media_metadata (file_path_hash, file_path, duration, size, created_at, rating, extraction_status, playback_position, in_library)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(file_path_hash) DO UPDATE SET
       file_path = excluded.file_path,
       duration = COALESCE(excluded.duration, media_metadata.duration),
       size = COALESCE(excluded.size, media_metadata.size),
       created_at = COALESCE(excluded.created_at, media_metadata.created_at),
       rating = COALESCE(excluded.rating, media_metadata.rating),
       extraction_status = COALESCE(excluded.extraction_status, media_metadata.extraction_status),
       playback_position = COALESCE(excluded.playback_position, media_metadata.playback_position),
       in_library = 1`,
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
    statements.executeSmartPlaylist = db.prepare(`
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
      WHERE in_library = 1 AND file_path IS NOT NULL
    `);
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

    // Optimized query for metadata verification (skips duration, rating, watched segments)
    statements.getAllMetadataVerification = db.prepare(
      `SELECT
        file_path as filePath,
        size,
        created_at as createdAt,
        extraction_status as status
       FROM media_metadata WHERE file_path IS NOT NULL AND in_library = 1`,
    );

    // Filter Optimization: Get successful paths in batch
    statements.getSuccessfulPathsBatch = db.prepare(
      `SELECT file_path FROM media_metadata WHERE file_path IN (${placeholders}) AND extraction_status = 'success'`,
    );

    statements.getFileIdsByPathsBatch = db.prepare(
      `SELECT file_path, file_path_hash FROM media_metadata WHERE file_path IN (${placeholders})`,
    );

    console.log('[worker] SQLite database initialized at:', dbPath);
    return { success: true };
  } catch (error: unknown) {
    console.error('[worker] Failed to initialize database:', error);
    db = null; // Ensure db is null on failure
    return { success: false, error: (error as Error).message };
  }
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
  statements.deleteWatchedSegments.run(fileId);
  for (const seg of segments) {
    const s = seg as { start?: unknown; end?: unknown };
    if (s && typeof s.start === 'number') {
      statements.insertWatchedSegment.run(
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
 */
function runMetadataUpsert(fileId: string, payload: MetadataPayload): void {
  statements.upsertMetadata.run(
    fileId,
    payload.filePath,
    payload.duration === undefined ? null : payload.duration,
    payload.size === undefined ? null : payload.size,
    payload.createdAt === undefined ? null : payload.createdAt,
    payload.rating === undefined ? null : payload.rating,
    payload.status === undefined ? null : payload.status,
    payload.playbackPosition === undefined ? null : payload.playbackPosition,
  );
  if (
    payload.watchedSegments !== undefined &&
    payload.watchedSegments !== null
  ) {
    replaceWatchedSegments(fileId, payload.watchedSegments);
  }
}

/**
 * Upserts metadata for a file.
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
      runMetadataUpsert(fileId, payload);
    } else {
      // Segment replacement spans multiple statements; keep it atomic.
      db.exec('BEGIN');
      try {
        runMetadataUpsert(fileId, payload);
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
    statements.updateRating.run(fileId, rating);
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
      statements.ensureMetadataRow.run(fileId);
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
    statements.updatePlaybackPosition.run(
      fileId,
      Number.isFinite(position) ? Math.max(0, position) : 0,
    );
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Bulk upserts metadata for multiple files.
 */
export async function bulkUpsertMetadata(
  payloads: MetadataPayload[],
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    // Bolt Optimization: Filter out payloads that are just "path confirmation" (no new data)
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
      const existingPaths = getExistingPathsBatch(paths);

      // Bolt Optimization: Use manual loop instead of Array.prototype.filter and spread operator to avoid allocation overhead and call stack limits
      for (const p of pathOnlyPayloads) {
        if (!existingPaths.has(p.filePath)) {
          payloadsToProcess.push(p);
        }
      }
    }

    if (payloadsToProcess.length === 0) {
      return { success: true };
    }

    const idMap = await generateFileIdsBatched(
      payloadsToProcess.map((p) => p.filePath),
    );

    // Map payloads to include fileId, failing if any ID is missing
    const itemsWithIds = payloadsToProcess.map((p) => {
      const fileId = idMap.get(p.filePath);
      if (!fileId) {
        throw new Error(`Failed to generate ID for path: ${p.filePath}`);
      }
      return Object.assign({ fileId }, p);
    });

    db.exec('BEGIN');
    try {
      for (const item of itemsWithIds) {
        runMetadataUpsert(item.fileId, item);
      }
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
 * Retrieves metadata for all files.
 */
export function getAllMetadata(): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = statements.getAllMetadata.all() as {
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
    const rows = statements.getAllMetadataVerification.all() as {
      filePath: string;
      size: number;
      createdAt: string;
      status: string;
    }[];

    // Bolt Optimization: Return raw rows to avoid blocking worker with heavy transformation.
    // The transformation to a map will be handled by the consumer.
    return { success: true, data: rows };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Filters a list of file paths to only those that need metadata processing.
 * Removes paths that are already marked as 'success' in the database.
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

    for (let i = 0; i < filePaths.length; i += SQL_BATCH_SIZE) {
      const batchPaths = filePaths.slice(i, i + SQL_BATCH_SIZE);
      if (batchPaths.length === 0) continue;

      let rows: { file_path: string }[];

      if (batchPaths.length === SQL_BATCH_SIZE) {
        // Use cached prepared statement for full batches
        rows = statements.getSuccessfulPathsBatch.all(...batchPaths) as {
          file_path: string;
        }[];
      } else {
        // Pad the batch with nulls to use the cached statement
        // This avoids recompiling the statement for variable batch sizes
        // Bolt Optimization: Use Object.assign for faster array copy
        const args = Object.assign(
          new Array(SQL_BATCH_SIZE).fill(null),
          batchPaths,
        );
        rows = statements.getSuccessfulPathsBatch.all(...args) as {
          file_path: string;
        }[];
      }

      for (const row of rows) {
        successfulPathsSet.add(row.file_path);
      }
    }

    // Bolt Optimization: Use allocation-free iteration to reduce GC pressure
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

    for (let i = 0; i < allFileIds.length; i += SQL_BATCH_SIZE) {
      const batchIds = allFileIds.slice(i, i + SQL_BATCH_SIZE);
      if (batchIds.length === 0) continue;

      let rows: { filePath: string; [key: string]: unknown }[];

      if (batchIds.length === SQL_BATCH_SIZE) {
        rows = statements.getMetadataBatch.all(...batchIds) as {
          filePath: string;
          [key: string]: unknown;
        }[];
      } else {
        const args = new Array(SQL_BATCH_SIZE).fill(null);
        for (let k = 0; k < batchIds.length; k++) {
          args[k] = batchIds[k];
        }
        rows = statements.getMetadataBatch.all(...args) as {
          filePath: string;
          [key: string]: unknown;
        }[];
      }

      for (const row of rows) {
        if (row && row.filePath) {
          metadataMap[row.filePath] = row;
        }
      }
    }

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
    const result = statements.createSmartPlaylist.run(name, criteria);
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
    const playlists = statements.getSmartPlaylists.all();
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
    statements.deleteSmartPlaylist.run(id);
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
    statements.updateSmartPlaylist.run(name, criteria, id);
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
    const rows = statements.getRecentlyPlayed.all(limit);
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
    statements.saveSetting.run(key, value, new Date().toISOString());
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
    const row = statements.getSetting.get(key) as { value: string } | undefined;
    return { success: true, data: row ? row.value : null };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

/**
 * Executes a smart playlist criteria to find matching files.
 */
export function executeSmartPlaylist(criteriaJson?: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    // Bolt Optimization: Use cached prepared statement for empty criteria
    // This avoids recompiling the SQL statement for the default "view all" case
    if (!criteriaJson || criteriaJson === '{}') {
      const rows = statements.executeSmartPlaylist.all();
      return { success: true, data: rows };
    }

    let sql = `
      SELECT
        file_path_hash,
        file_path,
        duration,
        rating,
        created_at,
        COALESCE(view_count, 0) as view_count,
        last_viewed
      FROM media_metadata
      WHERE in_library = 1 AND file_path IS NOT NULL
    `;
    const params: (number | string)[] = [];

    if (criteriaJson && criteriaJson !== '{}') {
      try {
        const criteria = JSON.parse(criteriaJson);

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

    // Bolt Optimization: Filter in SQL instead of fetching all rows
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
    statements.recordView.run(fileId, filePath, now);
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
    for (let i = 0; i < filePaths.length; i += SQL_BATCH_SIZE) {
      const batchPaths = filePaths.slice(i, i + SQL_BATCH_SIZE);
      let rows: { file_path: string; view_count: number }[];

      if (batchPaths.length === SQL_BATCH_SIZE) {
        // Use cached prepared statement for full batches
        // No iteration allocation needed, just spread
        rows = statements.getMediaViewCountsBatch.all(...batchPaths) as {
          file_path: string;
          view_count: number;
        }[];
      } else {
        // Pad the batch with nulls to use the cached statement
        // This avoids recompiling the statement for variable batch sizes
        const args = new Array(SQL_BATCH_SIZE).fill(null);
        for (let k = 0; k < batchPaths.length; k++) {
          args[k] = batchPaths[k];
        }
        rows = statements.getMediaViewCountsBatch.all(...args) as {
          file_path: string;
          view_count: number;
        }[];
      }

      for (const row of rows) {
        viewCountsMap[row.file_path] = row.view_count;
      }
    }

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
 * Caches album data in the database.
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
    // 1. Traverse and index all paths into media_metadata (whitelist for Drive & Local)
    // This ensures every file in the library is strictly "authorized" via DB presence.
    if (Array.isArray(albums)) {
      const paths: string[] = [];
      const stack: Album[] = [...(albums as Album[])];

      while (stack.length > 0) {
        const album = stack.pop();
        if (album) {
          if (album.textures && Array.isArray(album.textures)) {
            // Bolt Optimization: Use manual loop to avoid multiple intermediate arrays
            for (const t of album.textures) {
              if (t && t.path) {
                paths.push(t.path);
              }
            }
          }
          if (album.children && Array.isArray(album.children)) {
            for (let i = album.children.length - 1; i >= 0; i--) {
              stack.push(album.children[i]);
            }
          }
        }
      }

      if (paths.length > 0) {
        // Bulk upsert to ensure they are in the DB.
        // We pass only filePath; existing metadata (duration, etc.) is preserved by upsert logic.
        const payloads = paths.map((p) => ({ filePath: p }));
        // We can reuse bulkUpsertMetadata logic.
        await bulkUpsertMetadata(payloads);
      }
    }

    statements.cacheAlbum.run(
      cacheKey,
      JSON.stringify(albums),
      new Date().toISOString(),
    );
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
    const row = statements.getCachedAlbum.get(cacheKey) as
      | { cache_value: string }
      | undefined;
    const data = row && row.cache_value ? JSON.parse(row.cache_value) : null;
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
    db.close();
    db = null;
    // Clear statements cache
    for (const key in statements) {
      delete statements[key];
    }
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
    const type = payload.type || 'local';
    const name = payload.name || path.basename(payload.path) || payload.path;

    statements.addMediaDirectory.run(id, payload.path, type, name);
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
    const rows = statements.getMediaDirectories.all() as {
      id: string;
      path: string;
      type: string;
      name: string;
      is_active: number;
    }[];
    const directories = rows.map((row) => ({
      id: row.id,
      path: row.path,
      type: row.type as 'local' | 'google_drive',
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
 * Removes a media directory path from the database.
 * @param directoryPath - The path of the directory to remove.
 * @returns The result of the operation.
 */
export function removeMediaDirectory(directoryPath: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    statements.removeMediaDirectory.run(directoryPath);
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
 * Updates the active state of a media directory.
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
    statements.setDirectoryActiveState.run(isActive ? 1 : 0, directoryPath);
    return { success: true };
  } catch (error: unknown) {
    console.error(
      `[worker] Error updating active state for ${directoryPath}:`,
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
    statements.addJob.run(jobType, filePath, fileId);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export function listJobs(jobType: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = statements.listJobs.all(jobType);
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
    statements.updateJobStatus.run(status, error, jobType, filePath);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: (err as Error).message };
  }
}

export function deleteJob(jobType: string, filePath: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    statements.deleteJob.run(jobType, filePath);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

export function getPendingJobs(jobType: string): WorkerResult {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const rows = statements.getPendingJobs.all(jobType) as {
      file_path: string;
    }[];
    return { success: true, data: rows.map((r) => r.file_path) };
  } catch (error: unknown) {
    return { success: false, error: (error as Error).message };
  }
}

if (parentPort) {
  /**
   * Listen for messages from the main thread.
   */
  parentPort.on('message', async (message) => {
    const { id, type, payload } = message;
    let result: WorkerResult;

    try {
      switch (type) {
        case 'init':
          result = initDatabase(payload.dbPath);
          break;
        case 'recordMediaView':
          result = await recordMediaView(payload.filePath);
          break;
        case 'getMediaViewCounts':
          result = await getMediaViewCounts(payload.filePaths);
          break;
        case 'cacheAlbums':
          result = await cacheAlbums(payload.cacheKey, payload.albums);
          break;
        case 'getCachedAlbums':
          result = getCachedAlbums(payload.cacheKey);
          break;
        case 'close':
          result = closeDatabase();
          break;
        case 'addMediaDirectory':
          // Accepts simple string or object now
          result = addMediaDirectory(payload.directoryObj);
          break;
        case 'getMediaDirectories':
          result = getMediaDirectories();
          break;
        case 'removeMediaDirectory':
          result = removeMediaDirectory(payload.directoryPath);
          break;
        case 'setDirectoryActiveState':
          result = setDirectoryActiveState(
            payload.directoryPath,
            payload.isActive,
          );
          break;
        case 'upsertMetadata':
          result = await upsertMetadata(payload);
          break;
        case 'bulkUpsertMetadata':
          result = await bulkUpsertMetadata(payload);
          break;
        case 'setRating':
          result = await setRating(payload.filePath, payload.rating);
          break;
        case 'updateWatchedSegments':
          result = await updateWatchedSegments(
            payload.filePath,
            payload.segmentsJson,
          );
          break;
        case 'updatePlaybackPosition':
          result = await updatePlaybackPosition(
            payload.filePath,
            payload.position,
          );
          break;
        case 'getAllMetadata':
          result = getAllMetadata();
          break;
        case 'getAllMetadataVerification':
          result = getAllMetadataVerification();
          break;
        case 'getMetadata':
          result = await getMetadata(payload.filePaths);
          break;
        case 'createSmartPlaylist':
          result = createSmartPlaylist(payload.name, payload.criteria);
          break;
        case 'getSmartPlaylists':
          result = getSmartPlaylists();
          break;
        case 'deleteSmartPlaylist':
          result = deleteSmartPlaylist(payload.id);
          break;
        case 'updateSmartPlaylist':
          result = updateSmartPlaylist(
            payload.id,
            payload.name,
            payload.criteria,
          );
          break;
        case 'saveSetting':
          result = saveSetting(payload.key, payload.value);
          break;
        case 'getSetting':
          result = getSetting(payload.key);
          break;
        case 'executeSmartPlaylist':
          result = executeSmartPlaylist(payload.criteria);
          break;
        case 'getRecentlyPlayed':
          result = getRecentlyPlayed(payload.limit);
          break;
        case 'getPendingMetadata':
          if (!db) {
            result = { success: false, error: 'DB not ready' };
            break;
          }
          const pending = statements.getPendingMetadata.all() as {
            file_path: string;
          }[];
          result = { success: true, data: pending.map((p) => p.file_path) };
          break;
        case 'filterProcessingNeeded':
          result = await filterProcessingNeeded(payload.filePaths);
          break;
        case 'addTranscodeJob':
          result = await addJob(JOB_TYPE_TRANSCODE, payload.filePath);
          break;
        case 'listTranscodeJobs':
          result = listJobs(JOB_TYPE_TRANSCODE);
          break;
        case 'updateTranscodeJobStatus':
          result = updateJobStatus(
            JOB_TYPE_TRANSCODE,
            payload.filePath,
            payload.status,
            payload.error ?? null,
          );
          break;
        case 'deleteTranscodeJob':
          result = deleteJob(JOB_TYPE_TRANSCODE, payload.filePath);
          break;
        case 'getPendingTranscodeJobs':
          result = getPendingJobs(JOB_TYPE_TRANSCODE);
          break;
        case 'addJob':
          result = await addJob(payload.jobType, payload.filePath);
          break;
        case 'listJobs':
          result = listJobs(payload.jobType);
          break;
        case 'updateJobStatus':
          result = updateJobStatus(
            payload.jobType,
            payload.filePath,
            payload.status,
            payload.error ?? null,
          );
          break;
        case 'deleteJob':
          result = deleteJob(payload.jobType, payload.filePath);
          break;
        case 'getPendingJobs':
          result = getPendingJobs(payload.jobType);
          break;
        default:
          result = { success: false, error: `Unknown message type: ${type}` };
      }
    } catch (error: unknown) {
      console.error(
        `[worker] Error processing message id=${id}, type=${type}:`,
        error,
      );
      result = { success: false, error: (error as Error).message };
    }

    parentPort!.postMessage({ id, result });
  });

  console.log('[database-worker.js] Worker thread started and ready.');
  parentPort.postMessage({ type: 'ready' });
}
