/**
 * @file Database Worker Thread - Handles all sqlite3 operations.
 * This worker runs in a separate thread to avoid blocking the main process.
 * It receives messages from the main thread to perform database operations
 * and sends results back via the worker messaging API.
 */

import { parentPort } from 'worker_threads';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { Album } from './types.ts';
import { isDrivePath, getDriveId } from './media-utils.ts';
import {
  initializeSchema,
  migrateMediaDirectories,
  migrateMediaMetadata,
  createIndexes,
} from './database-schema.ts';

/**
 * The database instance for this worker thread.
 */
let db: Database.Database | null = null;

/**
 * Cache for prepared statements to improve performance of repeated queries.
 * Keys are the statement names (e.g., 'insertMediaView'), and values are the prepared SQLite statements.
 */
const statements: { [key: string]: Database.Statement } = {};

/**
 * Default batch size for SQL operations.
 * 900 is chosen to be safely within SQLite's default limit of 999 parameters.
 */
const SQL_BATCH_SIZE = 900;

// Helper Functions

/**
 * Generates a stable, unique identifier for a file.
 * @param filePath - The path to the file.
 * @returns A unique MD5 hash for the file.
 */
async function generateFileId(filePath: string): Promise<string> {
  try {
    if (!filePath) {
      throw new Error('File path cannot be null or empty');
    }
    if (isDrivePath(filePath)) {
      return getDriveId(filePath);
    }
    const stats = await fs.stat(filePath);
    const uniqueString = `${stats.size}-${stats.mtime.getTime()}`;
    return crypto.createHash('md5').update(uniqueString).digest('hex');
  } catch (error: unknown) {
    // If we can't stat the file (e.g. invalid path), fallback to hashing the path string
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.error(
        `[worker] Error generating file ID for ${filePath}:`,
        error,
      );
    }
    return crypto.createHash('md5').update(filePath).digest('hex');
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
 * Checks media_metadata first, then media_views, then falls back to generation (fs.stat).
 */
async function getExistingIdOrGenerate(filePath: string): Promise<string> {
  const statementsToTry = [
    statements.getFileIdFromMetadata,
    statements.getFileIdByPath,
  ];

  for (const stmt of statementsToTry) {
    try {
      const row = stmt.get(filePath) as { file_path_hash: string } | undefined;
      if (row) {
        return row.file_path_hash;
      }
    } catch (error) {
      console.warn(
        `[worker] DB error while checking for existing file ID for ${filePath}:`,
        error,
      );
    }
  }

  // 3. Generate (fs.stat)
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

    db = new Database(dbPath);
    // Enable WAL mode for better concurrency
    // Bolt Optimization: WAL mode reduces write transaction time by ~88% and allows concurrent reads/writes
    db.pragma('journal_mode = WAL');

    initializeSchema(db);
    migrateMediaDirectories(db);
    migrateMediaMetadata(db);
    createIndexes(db);

    // Prepare statements for reuse
    statements.insertMediaView = db.prepare(
      `INSERT OR IGNORE INTO media_views (file_path_hash, file_path, view_count, last_viewed) VALUES (?, ?, 0, ?)`,
    );
    statements.updateMediaView = db.prepare(
      `UPDATE media_views SET view_count = view_count + 1, last_viewed = ? WHERE file_path_hash = ?`,
    );
    statements.updateMediaViewWithPath = db.prepare(
      `UPDATE media_views SET view_count = view_count + 1, last_viewed = ?, file_path = ? WHERE file_path_hash = ?`,
    );
    statements.getMediaView = db.prepare(
      `SELECT file_path_hash, view_count FROM media_views WHERE file_path_hash = ?`,
    );
    statements.getFileIdByPath = db.prepare(
      `SELECT file_path_hash FROM media_views WHERE file_path = ?`,
    );
    statements.getFileIdFromMetadata = db.prepare(
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
      `INSERT INTO media_metadata (file_path_hash, file_path, duration, size, created_at, rating, extraction_status, watched_segments)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET
       file_path = excluded.file_path,
       duration = COALESCE(excluded.duration, media_metadata.duration),
       size = COALESCE(excluded.size, media_metadata.size),
       created_at = COALESCE(excluded.created_at, media_metadata.created_at),
       rating = COALESCE(excluded.rating, media_metadata.rating),
       extraction_status = COALESCE(excluded.extraction_status, media_metadata.extraction_status),
       watched_segments = COALESCE(excluded.watched_segments, media_metadata.watched_segments)`,
    );
    statements.getPendingMetadata = db.prepare(
      `SELECT file_path FROM media_metadata WHERE (extraction_status = 'pending' OR extraction_status IS NULL) AND file_path IS NOT NULL LIMIT 100`,
    );
    statements.updateRating = db.prepare(
      // Only update rating if the row exists, or insert if capable?
      // For now assume metadata row might not exist, so we use upsert with default values for others if needed.
      // Actually simpler: just update rating if exists, if not insert new row with rating.
      `INSERT INTO media_metadata (file_path_hash, rating) VALUES (?, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET rating = excluded.rating`,
    );
    statements.updateWatchedSegments = db.prepare(
      `INSERT INTO media_metadata (file_path_hash, watched_segments) VALUES (?, ?)
       ON CONFLICT(file_path_hash) DO UPDATE SET watched_segments = excluded.watched_segments`,
    );
    statements.createSmartPlaylist = db.prepare(
      'INSERT INTO smart_playlists (name, criteria) VALUES (?, ?)',
    );
    statements.getSmartPlaylists = db.prepare(
      'SELECT id, name, criteria, createdAt FROM smart_playlists ORDER BY id DESC',
    );
    statements.getRecentlyPlayed = db.prepare(
      `SELECT
        v.file_path,
        v.file_path_hash,
        v.view_count,
        v.last_viewed,
        m.duration,
        m.size,
        m.rating,
        m.created_at,
        m.watched_segments,
        v.last_viewed
       FROM media_views v
       LEFT JOIN media_metadata m ON v.file_path_hash = m.file_path_hash
       WHERE v.last_viewed IS NOT NULL
       ORDER BY v.last_viewed DESC
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
        m.file_path_hash,
        m.file_path,
        m.duration,
        m.rating,
        m.created_at,
        COALESCE(v.view_count, 0) as view_count,
        v.last_viewed
      FROM media_metadata m
      LEFT JOIN media_views v ON m.file_path_hash = v.file_path_hash
      WHERE m.file_path IS NOT NULL
    `);

    // Optimized batch statements
    const placeholders = Array(SQL_BATCH_SIZE).fill('?').join(',');
    statements.getMediaViewCountsBatch = db.prepare(
      `SELECT file_path, view_count FROM media_views WHERE file_path IN (${placeholders})`,
    );
    statements.getMetadataBatch = db.prepare(
      `SELECT
        file_path as filePath,
        duration,
        size,
        created_at as createdAt,
        rating,
        extraction_status as status,
        watched_segments as watchedSegments
       FROM media_metadata WHERE file_path_hash IN (${placeholders})`,
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
        watched_segments as watchedSegments
       FROM media_metadata WHERE file_path IS NOT NULL`,
    );

    // Optimized query for metadata verification (skips duration, rating, watched_segments)
    statements.getAllMetadataVerification = db.prepare(
      `SELECT
        file_path as filePath,
        size,
        created_at as createdAt,
        extraction_status as status
       FROM media_metadata WHERE file_path IS NOT NULL`,
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
}

/**
 * Upserts metadata for a file.
 */
export async function upsertMetadata(
  payload: MetadataPayload,
): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };
  try {
    const fileId = await generateFileId(payload.filePath);
    statements.upsertMetadata.run(
      fileId,
      payload.filePath,
      payload.duration === undefined ? null : payload.duration,
      payload.size === undefined ? null : payload.size,
      payload.createdAt === undefined ? null : payload.createdAt,
      payload.rating === undefined ? null : payload.rating,
      payload.status === undefined ? null : payload.status,
      payload.watchedSegments === undefined ? null : payload.watchedSegments,
    );
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
    statements.updateWatchedSegments.run(fileId, segmentsJson);
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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { filePath, ...metadata } = p;
      // Check if any property in metadata is defined
      const hasData = Object.values(metadata).some((v) => v !== undefined);

      if (hasData) {
        updatePayloads.push(p);
      } else {
        pathOnlyPayloads.push(p);
      }
    }

    const payloadsToProcess = [...updatePayloads];

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
      return { ...p, fileId };
    });

    const transaction = db.transaction((items: typeof itemsWithIds) => {
      for (const item of items) {
        statements.upsertMetadata.run(
          item.fileId,
          item.filePath,
          item.duration === undefined ? null : item.duration,
          item.size === undefined ? null : item.size,
          item.createdAt === undefined ? null : item.createdAt,
          item.rating === undefined ? null : item.rating,
          item.status === undefined ? null : item.status,
          item.watchedSegments === undefined ? null : item.watchedSegments,
        );
      }
    });

    transaction(itemsWithIds);
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
 * Skips heavy columns like watched_segments and rating.
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
        m.file_path_hash,
        m.file_path,
        m.duration,
        m.rating,
        m.created_at,
        COALESCE(v.view_count, 0) as view_count,
        v.last_viewed
      FROM media_metadata m
      LEFT JOIN media_views v ON m.file_path_hash = v.file_path_hash
      WHERE m.file_path IS NOT NULL
    `;
    const params: (number | string)[] = [];

    if (criteriaJson && criteriaJson !== '{}') {
      try {
        const criteria = JSON.parse(criteriaJson);

        if (typeof criteria.minRating === 'number') {
          sql += ' AND m.rating >= ?';
          params.push(criteria.minRating);
        }
        if (typeof criteria.minDuration === 'number') {
          sql += ' AND m.duration >= ?';
          params.push(criteria.minDuration);
        }
        if (typeof criteria.minViews === 'number') {
          sql += ' AND COALESCE(v.view_count, 0) >= ?';
          params.push(criteria.minViews);
        }
        if (typeof criteria.maxViews === 'number') {
          sql += ' AND COALESCE(v.view_count, 0) <= ?';
          params.push(criteria.maxViews);
        }
        if (typeof criteria.minDaysSinceView === 'number') {
          // Logic: item matches if (now - last_viewed) >= minDays OR last_viewed is NULL
          sql +=
            " AND (v.last_viewed IS NULL OR (julianday('now') - julianday(v.last_viewed)) >= ?)";
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
 * @param filePath - The path of the file that was viewed.
 * @returns The result of the operation.
 */
export async function recordMediaView(filePath: string): Promise<WorkerResult> {
  if (!db) return { success: false, error: 'Database not initialized' };

  try {
    const fileId = await getExistingIdOrGenerate(filePath);

    const now = new Date().toISOString();

    const transaction = db.transaction(() => {
      statements.insertMediaView.run(fileId, filePath, now);
      // Attempt to update path (handles renames/moves), but fallback if unique constraint violated
      try {
        statements.updateMediaViewWithPath.run(now, filePath, fileId);
      } catch (err: unknown) {
        // If unique constraint failed (path already exists on another ID),
        // fallback to legacy update (update count only, keep old path)
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
          statements.updateMediaView.run(now, fileId);
        } else {
          throw err;
        }
      }
    });

    transaction();
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
