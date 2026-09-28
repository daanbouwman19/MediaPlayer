/**
 * @file Manages all database interactions for the application using a Worker Thread.
 * This module acts as a bridge between the main process (or server) and the database worker thread.
 */

import fs from 'fs';
import { type WorkerOptions } from 'worker_threads';
import { FILE_INDEX_CACHE_KEY } from '../media/constants.ts';
import { isDrivePath } from '../media/media-utils.ts';
import { safeLog, safeWarn, safeError } from '../media/utils/logger.ts';
import type {
  Album,
  MediaDirectory,
  SmartPlaylist,
  MediaMetadata,
  MediaLibraryItem,
} from '../media/types.ts';
import { WorkerClient } from './worker-client.ts';
import {
  normalizeWatchedSegments,
  parseMetadataUpdate,
} from './metadata-validation.ts';
import { clearAuthCache, isSensitiveDirectory } from '../auth/security.ts';
import { AppError } from '../media/errors.ts';

/**
 * The database worker client instance.
 */
let dbWorkerClient: WorkerClient | null = null;

/**
 * Cache for media directories to avoid frequent IPC calls.
 */
let cachedMediaDirectories: MediaDirectory[] | null = null;

/**
 * Bumped by every invalidation of the directory caches. A directory read
 * only fills the cache if no invalidation happened while it was in flight;
 * otherwise it may predate a mutation that has since been written.
 */
let mediaDirectoriesGeneration = 0;

/** The directory read in flight, shared by callers of the same generation. */
let pendingMediaDirectories: {
  generation: number;
  promise: Promise<MediaDirectory[]>;
} | null = null;

/**
 * Drops every cache derived from the media-directory set: the directory
 * list and the authorization decisions made against it.
 */
function invalidateDirectoryCaches(): void {
  mediaDirectoriesGeneration++;
  cachedMediaDirectories = null;
  pendingMediaDirectories = null;
  clearAuthCache();
}

/**
 * Initializes the database by creating and managing a worker thread.
 * If an existing worker is present, it will be terminated and a new one started.
 * @param userDbPath - Absolute path to the SQLite database file.
 * @param workerScriptPath - Absolute path or URL to the worker script.
 * @param workerOptions - Optional WorkerOptions to pass to the Worker constructor.
 * @returns A promise that resolves when the database is successfully initialized.
 * @throws {Error} If the worker initialization fails.
 */
async function initDatabase(
  userDbPath: string,
  workerScriptPath: string | URL,
  workerOptions?: WorkerOptions,
): Promise<void> {
  if (dbWorkerClient) {
    await dbWorkerClient.terminate();
  }
  invalidateDirectoryCaches();

  const client = new WorkerClient(workerScriptPath, {
    workerOptions,
    operationTimeout: 30000,
    // Opening a large database can include schema migrations.
    initTimeout: 120000,
    name: 'database.js',
    autoRestart: true,
    restartDelay: 2000,
  });
  dbWorkerClient = client;
  await client.init({ type: 'init', payload: { dbPath: userDbPath } });

  try {
    await revalidateMediaDirectories(client);
  } catch (error) {
    safeError('[database.js] Failed to re-check media directories:', error);
  }
}

/** How long a stored directory may take to resolve (offline network shares). */
const DIRECTORY_RESOLVE_TIMEOUT_MS = 3000;

const RESOLVE_TIMED_OUT = Symbol('resolve timed out');

/** What {@link resolveStoredDirectory} makes of a stored directory path. */
type ResolvedPath = string | null | typeof RESOLVE_TIMED_OUT;

/**
 * Resolves a stored media directory to its real path with fs.realpath's
 * callback form. That is the JS implementation: it resolves symlinks and
 * junctions like the native one, but keeps mapped network drive letters
 * instead of turning them into UNC paths. Returns null when the directory
 * cannot be resolved (missing or unreadable), or {@link RESOLVE_TIMED_OUT}
 * when resolution hangs, so startup is never blocked by it.
 */
async function resolveStoredDirectory(
  directoryPath: string,
): Promise<ResolvedPath> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<typeof RESOLVE_TIMED_OUT>((resolve) => {
    timer = setTimeout(
      () => resolve(RESOLVE_TIMED_OUT),
      DIRECTORY_RESOLVE_TIMEOUT_MS,
    );
  });
  const realPath = new Promise<string>((resolve, reject) => {
    fs.realpath(directoryPath, (error, resolved) => {
      if (error) reject(error);
      else resolve(resolved);
    });
  });
  try {
    return await Promise.race([realPath, timeout]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-checks the stored media directories against the rules a new source
 * has to pass. Rows added before those checks existed can point, directly
 * or through a symlink or junction, at a sensitive system location, and
 * authorization trusts them on every request. Sensitive local sources are
 * deactivated and logged (never deleted); the others are rewritten to their
 * canonical path, so a link cannot later be retargeted to widen access.
 * Runs on every start and leaves rows that pass untouched (idempotent).
 */
async function revalidateMediaDirectories(client: WorkerClient): Promise<void> {
  const directories = await client.sendMessage<MediaDirectory[] | null>(
    'getMediaDirectories',
  );
  if (!Array.isArray(directories)) return;

  const storedPaths = new Set<string>();
  const localDirectories: MediaDirectory[] = [];
  for (const dir of directories) {
    if (!dir || typeof dir.path !== 'string') continue;
    storedPaths.add(dir.path);
    if (!isDrivePath(dir.path)) localDirectories.push(dir);
  }

  // Resolve all roots at once, so offline network shares cost one
  // DIRECTORY_RESOLVE_TIMEOUT_MS in total rather than one each.
  const resolved = await Promise.all(
    localDirectories.map(
      async (dir): Promise<[MediaDirectory, ResolvedPath]> => [
        dir,
        await resolveStoredDirectory(dir.path),
      ],
    ),
  );

  let changed = false;
  for (const [dir, realPath] of resolved) {
    try {
      changed =
        (await revalidateMediaDirectory(client, dir, realPath, storedPaths)) ||
        changed;
    } catch (error) {
      safeError(
        `[database.js] Failed to re-check media directory ${dir.path}:`,
        error,
      );
    }
  }

  if (changed) {
    invalidateDirectoryCaches();
  }
}

/**
 * Applies {@link revalidateMediaDirectories} to one local directory.
 * @param realPath - The directory's resolved path (see
 *   {@link resolveStoredDirectory}).
 * @param storedPaths - The paths of all stored media directories.
 * @returns Whether the directory row was changed.
 */
async function revalidateMediaDirectory(
  client: WorkerClient,
  dir: MediaDirectory,
  realPath: ResolvedPath,
  storedPaths: ReadonlySet<string>,
): Promise<boolean> {
  if (realPath === RESOLVE_TIMED_OUT) {
    safeWarn(
      `[database.js] Skipped re-checking media directory ${dir.path}: it did not resolve in time.`,
    );
    return false;
  }

  if (
    isSensitiveDirectory(dir.path) ||
    (realPath !== null && isSensitiveDirectory(realPath))
  ) {
    if (!dir.isActive) return false;
    safeWarn(
      `[Security] Deactivated media directory ${dir.path}: it is (or resolves to) a sensitive system location.`,
    );
    await client.sendMessage('setDirectoryActiveState', {
      directoryPath: dir.path,
      isActive: false,
    });
    return true;
  }

  if (realPath === null || realPath === dir.path) return false;
  // An alias of a source stored at its real path is only deactivated (see
  // canonicalizeMediaDirectory), so once inactive it needs nothing more.
  if (!dir.isActive && storedPaths.has(realPath)) return false;
  safeLog(
    `[database.js] Canonicalized media directory ${dir.path} -> ${realPath}`,
  );
  await client.sendMessage('canonicalizeMediaDirectory', {
    directoryPath: dir.path,
    canonicalPath: realPath,
  });
  return true;
}

/**
 * Helper to get the client or throw if not initialized.
 */
function getClient(): WorkerClient {
  if (!dbWorkerClient) {
    throw new Error('Database worker not initialized');
  }
  return dbWorkerClient;
}

/**
 * Records a view for a media file.
 * @param filePath - The path to the media file.
 * @returns A promise that resolves when the view is recorded. Errors are logged but not re-thrown.
 */
async function recordMediaView(filePath: string): Promise<void> {
  try {
    await getClient().sendMessage<void>('recordMediaView', { filePath });
  } catch (error: unknown) {
    safeWarn(
      `[database.js] Error recording media view: ${(error as Error).message}`,
    );
  }
}

/**
 * Retrieves view counts for a list of media files.
 * @param filePaths - An array of file paths.
 * @returns A promise that resolves to a map of file paths to their view counts. Returns an empty object on error.
 */
async function getMediaViewCounts(
  filePaths: string[],
): Promise<{ [filePath: string]: number }> {
  if (!filePaths || filePaths.length === 0) {
    return {};
  }
  try {
    return await getClient().sendMessage<{ [filePath: string]: number }>(
      'getMediaViewCounts',
      { filePaths },
    );
  } catch (error) {
    safeError('[database.js] Error fetching view counts:', error);
    return {};
  }
}

/**
 * Caches the list of albums (file index) into the database. This also
 * records which files are library members, which is what authorizes Drive
 * files, so a failure is rethrown: a scan whose result could not be stored
 * must not be presented as the library.
 * @param albums - The array of album objects to cache.
 * @returns A promise that resolves when the albums are cached.
 * @throws {Error} If the database operation fails.
 */
async function cacheAlbums(albums: Album[]): Promise<void> {
  try {
    await getClient().sendMessage<void>('cacheAlbums', {
      cacheKey: FILE_INDEX_CACHE_KEY,
      albums,
    });
  } catch (error) {
    safeError('[database.js] Error caching albums:', error);
    throw error;
  } finally {
    // Library membership may have changed, and with it Drive authorization.
    clearAuthCache();
  }
}

/**
 * Caches the list of albums (file index) and propagates failures, including
 * the operation timeout. Library scans use this so the album cache is only
 * stamped as current once the new tree is confirmed stored.
 * @param albums - The array of album objects to cache.
 * @throws {Error} If the database operation fails or times out.
 */
async function storeAlbumCache(albums: Album[]): Promise<void> {
  try {
    await getClient().sendMessage<void>('cacheAlbums', {
      cacheKey: FILE_INDEX_CACHE_KEY,
      albums,
    });
  } catch (error) {
    safeError('[database.js] Error caching albums:', error);
    throw error;
  }
}

/**
 * Retrieves the cached list of albums from the database.
 * @returns A promise that resolves to the cached albums, or null if not found or an error occurs.
 */
async function getCachedAlbums(): Promise<Album[] | null> {
  try {
    return await getClient().sendMessage<Album[] | null>('getCachedAlbums', {
      cacheKey: FILE_INDEX_CACHE_KEY,
    });
  } catch (error: unknown) {
    safeWarn(
      `[database.js] Error getting cached albums: ${(error as Error).message}`,
    );
    return null;
  }
}

/**
 * Closes the database connection by terminating the worker thread.
 * @returns A promise that resolves when the worker has been terminated.
 */
async function closeDatabase(): Promise<void> {
  if (dbWorkerClient) {
    // Send close signal if needed, then terminate
    try {
      await dbWorkerClient.sendMessage<void>('close');
    } catch (error) {
      safeWarn('[database.js] Warning during worker shutdown:', error);
    } finally {
      await dbWorkerClient.terminate();
      dbWorkerClient = null;
    }
  }
}

/**
 * Sets the timeout duration for database operations. Useful for testing.
 * @param timeout - The timeout in milliseconds.
 */
function setOperationTimeout(timeout: number): void {
  if (dbWorkerClient) {
    dbWorkerClient.setOperationTimeout(timeout);
  }
}

/**
 * Adds a new media directory to the database.
 * @param directory - The absolute path of the directory to add, or an object with details.
 * @returns A promise that resolves on success or rejects on failure.
 * @throws {Error} If the database operation fails.
 */
async function addMediaDirectory(
  directory:
    | string
    | {
        id?: string;
        path: string;
        type?: 'local' | 'google_drive';
        name?: string;
      },
): Promise<void> {
  // The authorization cache keys file paths to allow/deny decisions derived
  // from the media-directory set. Changing that set can flip a decision, so
  // invalidate it here to avoid serving stale allows/denies within the TTL,
  // and again once the write is done to drop anything cached meanwhile.
  invalidateDirectoryCaches();
  try {
    const payload =
      typeof directory === 'string' ? { path: directory } : directory;

    await getClient().sendMessage<void>('addMediaDirectory', {
      directoryObj: payload,
    });
  } catch (error) {
    safeError(
      `[database.js] Error adding media directory '${typeof directory === 'string' ? directory : directory.path}':`,
      error,
    );
    throw error;
  } finally {
    invalidateDirectoryCaches();
  }
}

/**
 * Retrieves all media directories from the database.
 * Concurrent callers share one read, and a read that overlaps a directory
 * mutation is returned to its callers but never cached.
 * @returns A promise that resolves to a list of all media directory objects. Returns an empty array on error.
 */
async function getMediaDirectories(): Promise<MediaDirectory[]> {
  if (cachedMediaDirectories) {
    return [...cachedMediaDirectories];
  }
  try {
    const generation = mediaDirectoriesGeneration;
    let pending = pendingMediaDirectories;
    if (!pending || pending.generation !== generation) {
      const promise: Promise<MediaDirectory[]> = getClient()
        .sendMessage<MediaDirectory[] | null>('getMediaDirectories')
        .then((directories) => {
          const list = directories || [];
          if (generation === mediaDirectoriesGeneration) {
            cachedMediaDirectories = list;
          }
          return list;
        })
        .finally(() => {
          if (pendingMediaDirectories?.promise === promise) {
            pendingMediaDirectories = null;
          }
        });
      pending = { generation, promise };
      pendingMediaDirectories = pending;
    }
    return [...(await pending.promise)];
  } catch (error) {
    safeError('[database.js] Error getting media directories:', error);
    return [];
  }
}

/**
 * Removes a media directory from the database.
 * @param directoryPath - The absolute path of the directory to remove.
 * @returns A promise that resolves on success or rejects on failure.
 * @throws {Error} If the database operation fails.
 */
async function removeMediaDirectory(directoryPath: string): Promise<void> {
  invalidateDirectoryCaches();
  try {
    await getClient().sendMessage<void>('removeMediaDirectory', {
      directoryPath,
    });
  } catch (error) {
    safeError(
      '[database.js] Error removing media directory %s',
      directoryPath,
      error,
    );
    throw error;
  } finally {
    invalidateDirectoryCaches();
  }
}

/**
 * Updates the active state for a given media directory.
 * @param directoryPath - The path of the directory to update.
 * @param isActive - The new active state.
 * Re-activating a local source that is, or resolves to, a sensitive system
 * location is refused, so a source deactivated by the start-up re-check
 * (see {@link revalidateMediaDirectories}) cannot simply be switched back on.
 * @returns A promise that resolves on success or rejects on failure.
 * @throws {AppError} (403) If a sensitive local source would be re-activated.
 * @throws {Error} If the database operation fails.
 */
async function setDirectoryActiveState(
  directoryPath: string,
  isActive: boolean,
): Promise<void> {
  if (isActive && !isDrivePath(directoryPath)) {
    const realPath = await resolveStoredDirectory(directoryPath);
    if (
      isSensitiveDirectory(directoryPath) ||
      (typeof realPath === 'string' && isSensitiveDirectory(realPath))
    ) {
      safeWarn(
        `[Security] Refused to re-activate media directory ${directoryPath}: it is (or resolves to) a sensitive system location.`,
      );
      throw new AppError(
        403,
        'This directory is a sensitive system location and cannot be activated',
      );
    }
  }
  invalidateDirectoryCaches();
  try {
    await getClient().sendMessage<void>('setDirectoryActiveState', {
      directoryPath,
      isActive,
    });
  } catch (error) {
    safeError(
      '[database.js] Error setting active state for %s:',
      directoryPath,
      error,
    );
    throw error;
  } finally {
    invalidateDirectoryCaches();
  }
}

/**
 * Upserts client-supplied metadata for a file whose path the caller has
 * authorized. Only the known metadata fields are accepted, and the
 * authorized path is applied last so the payload cannot redirect the write
 * to another row.
 * @throws {AppError} (400) If the metadata is malformed.
 */
async function upsertMetadata(
  filePath: string,
  metadata: MediaMetadata,
): Promise<void> {
  const payload = { ...parseMetadataUpdate(metadata), filePath };
  try {
    await getClient().sendMessage<void>('upsertMetadata', payload);
  } catch (error) {
    safeError('[database.js] Error upserting metadata:', filePath, error);
    throw error;
  }
}

/**
 * Bulk upserts metadata for multiple files.
 */
async function bulkUpsertMetadata(
  payloads: ({ filePath: string } & MediaMetadata)[],
): Promise<void> {
  try {
    await getClient().sendMessage<void>('bulkUpsertMetadata', payloads);
  } catch (error) {
    safeError('[database.js] Error bulk upserting metadata:', error);
    throw error;
  }
}

/**
 * Sets the rating for a file.
 */
async function setRating(filePath: string, rating: number): Promise<void> {
  try {
    await getClient().sendMessage<void>('setRating', {
      filePath,
      rating,
    });
  } catch (error) {
    safeError('[database.js] Error setting rating:', filePath, error);
    throw error;
  }
}

/**
 * Updates watched segments for a file. Storage errors are logged but not
 * re-thrown — saving progress is best-effort.
 * @throws {AppError} (400) If the segments are malformed or too many.
 */
async function updateWatchedSegments(
  filePath: string,
  segmentsJson: string,
): Promise<void> {
  const segments = normalizeWatchedSegments(segmentsJson);
  try {
    await getClient().sendMessage<void>('updateWatchedSegments', {
      filePath,
      segmentsJson: segments,
    });
  } catch (error) {
    safeError(
      '[database.js] Error updating watched segments:',
      filePath,
      error,
    );
  }
}

/**
 * Updates the last-known playback position for a file (in seconds).
 * Errors are logged but never re-thrown — saving a resume point is best-effort.
 */
async function updatePlaybackPosition(
  filePath: string,
  position: number,
): Promise<void> {
  try {
    await getClient().sendMessage<void>('updatePlaybackPosition', {
      filePath,
      position,
    });
  } catch (error) {
    safeWarn(
      `[database.js] Error updating playback position for ${filePath}: ${(error as Error).message}`,
    );
  }
}

/**
 * Retrieves metadata for a list of files.
 */
async function getMetadata(
  filePaths: string[],
): Promise<{ [path: string]: MediaMetadata }> {
  try {
    return await getClient().sendMessage<{ [path: string]: MediaMetadata }>(
      'getMetadata',
      { filePaths },
    );
  } catch (error) {
    safeError('[database.js] Error getting metadata:', filePaths, error);
    return {};
  }
}

/**
 * Retrieves metadata for all files.
 */
async function getAllMetadata(): Promise<{ [path: string]: MediaMetadata }> {
  try {
    return await getClient().sendMessage<{ [path: string]: MediaMetadata }>(
      'getAllMetadata',
    );
  } catch (error) {
    safeError('[database.js] Error getting all metadata:', error);
    return {};
  }
}

/**
 * Retrieves lightweight metadata for verification checks.
 * Skips heavy columns like watched_segments and rating.
 */
async function getAllMetadataVerification(): Promise<{
  [path: string]: MediaMetadata;
}> {
  try {
    const rows = await getClient().sendMessage<
      {
        filePath: string;
        size: number;
        createdAt: string;
        status: string;
        // SQL NULL arrives as null; consumers check it with isMetadataComplete.
        duration?: number;
      }[]
    >('getAllMetadataVerification');

    // Use a standard for loop instead of reduce
    // to avoid allocation overhead on large arrays and improve iteration speed.
    const result: { [path: string]: MediaMetadata } = {};
    for (const row of rows) {
      if (row.filePath) {
        result[row.filePath] = row;
      }
    }
    return result;
  } catch (error) {
    safeError('[database.js] Error getting all metadata verification:', error);
    return {};
  }
}

/**
 * Reads the media directories straight from the database, bypassing the
 * directory cache, and propagates failures. Library scans use this so a
 * database error (e.g. during a worker restart) aborts the scan instead of
 * being read as "no sources" and cached as an empty library. Authorization
 * keeps using the fail-closed {@link getMediaDirectories}.
 * @returns A promise that resolves to all media directory objects.
 * @throws {Error} If the database operation fails.
 */
async function readMediaDirectories(): Promise<MediaDirectory[]> {
  const directories = await getClient().sendMessage<MediaDirectory[]>(
    'getMediaDirectories',
  );
  return directories || [];
}

/**
 * Creates a new smart playlist.
 */
async function createSmartPlaylist(
  name: string,
  criteria: string,
): Promise<{ id: number }> {
  // Input Validation
  if (!name || typeof name !== 'string' || name.length > 100) {
    throw new AppError(400, 'Invalid playlist name (1-100 characters).');
  }
  if (!criteria || typeof criteria !== 'string' || criteria.length > 10000) {
    throw new AppError(400, 'Invalid playlist criteria.');
  }
  try {
    JSON.parse(criteria);
  } catch {
    throw new AppError(400, 'Criteria must be valid JSON.');
  }

  try {
    return await getClient().sendMessage<{ id: number }>(
      'createSmartPlaylist',
      {
        name,
        criteria,
      },
    );
  } catch (error) {
    safeError('[database.js] Error creating smart playlist:', error);
    throw error;
  }
}

/**
 * Retrieves all smart playlists.
 */
async function getSmartPlaylists(): Promise<SmartPlaylist[]> {
  try {
    return await getClient().sendMessage<SmartPlaylist[]>('getSmartPlaylists');
  } catch (error) {
    safeError('[database.js] Error getting smart playlists:', error);
    return [];
  }
}

/**
 * Deletes a smart playlist.
 */
async function deleteSmartPlaylist(id: number): Promise<void> {
  try {
    await getClient().sendMessage<void>('deleteSmartPlaylist', { id });
  } catch (error) {
    safeError('[database.js] Error deleting smart playlist:', error);
    throw error;
  }
}

/**
 * Updates a smart playlist.
 */
async function updateSmartPlaylist(
  id: number,
  name: string,
  criteria: string,
): Promise<void> {
  // Input Validation
  if (!name || typeof name !== 'string' || name.length > 100) {
    throw new AppError(400, 'Invalid playlist name (1-100 characters).');
  }
  if (!criteria || typeof criteria !== 'string' || criteria.length > 10000) {
    throw new AppError(400, 'Invalid playlist criteria.');
  }
  try {
    JSON.parse(criteria);
  } catch {
    throw new AppError(400, 'Criteria must be valid JSON.');
  }

  try {
    await getClient().sendMessage<void>('updateSmartPlaylist', {
      id,
      name,
      criteria,
    });
  } catch (error) {
    safeError('[database.js] Error updating smart playlist:', error);
    throw error;
  }
}

/**
 * Saves a setting (key-value pair) to the database.
 */
async function saveSetting(key: string, value: string): Promise<void> {
  try {
    await getClient().sendMessage<void>('saveSetting', { key, value });
  } catch (error) {
    safeError('[database.js] Error saving setting:', error);
    throw error;
  }
}

/**
 * Retrieves a setting value from the database.
 */
async function getSetting(key: string): Promise<string | null> {
  try {
    return await getClient().sendMessage<string | null>('getSetting', { key });
  } catch (error) {
    safeError('[database.js] Error getting setting:', error);
    return null;
  }
}

/**
 * Executes a smart playlist criteria to find matching files.
 * @param criteria - The JSON stringified criteria.
 */
async function executeSmartPlaylist(
  criteria: string,
): Promise<MediaLibraryItem[]> {
  try {
    return await getClient().sendMessage<MediaLibraryItem[]>(
      'executeSmartPlaylist',
      {
        criteria,
      },
    );
  } catch (error) {
    safeError('[database.js] Error executing smart playlist:', error);
    return [];
  }
}

/**
 * Gets all metadata and stats for smart playlist filtering.
 * Returns a raw list of objects from the DB join.
 */
async function getAllMetadataAndStats(): Promise<MediaLibraryItem[]> {
  try {
    return await getClient().sendMessage<MediaLibraryItem[]>(
      'executeSmartPlaylist',
      {
        criteria: '{}',
      },
    );
  } catch (error) {
    safeError('[database.js] Error getting all metadata:', error);
    return [];
  }
}

export {
  initDatabase,
  closeDatabase,
  recordMediaView,
  getMediaViewCounts,
  cacheAlbums,
  storeAlbumCache,
  getCachedAlbums,
  addMediaDirectory,
  getMediaDirectories,
  readMediaDirectories,
  removeMediaDirectory,
  setDirectoryActiveState,
  setOperationTimeout,
  upsertMetadata,
  bulkUpsertMetadata,
  setRating,
  getMetadata,
  getAllMetadata,
  getAllMetadataVerification,
  createSmartPlaylist,
  getSmartPlaylists,
  deleteSmartPlaylist,
  updateSmartPlaylist,
  updateWatchedSegments,
  updatePlaybackPosition,
  saveSetting,
  getSetting,
  executeSmartPlaylist,
  getAllMetadataAndStats,
  getPendingMetadata,
  getRecentlyPlayed,
  filterProcessingNeeded,
  isFileInLibrary,
  addTranscodeJob,
  listTranscodeJobs,
  updateTranscodeJobStatus,
  deleteTranscodeJob,
  getPendingTranscodeJobs,
};

/**
 * Checks if a file exists in the library (metadata table).
 * @param filePath - The path to check.
 * @returns True if the file is known in the library.
 */
async function isFileInLibrary(filePath: string): Promise<boolean> {
  try {
    const meta = await getMetadata([filePath]);
    return !!meta[filePath];
  } catch (error) {
    safeError('[database.js] Error checking library presence:', error);
    return false;
  }
}

/**
 * Retrieves recently played media items.
 * @param limit - Max items to return (default 50).
 */
async function getRecentlyPlayed(limit = 50): Promise<MediaLibraryItem[]> {
  try {
    return await getClient().sendMessage<MediaLibraryItem[]>(
      'getRecentlyPlayed',
      {
        limit,
      },
    );
  } catch (error) {
    safeError('[database.js] Error getting recently played:', error);
    throw error;
  }
}

/**
 * Retrieves a list of file paths that have pending metadata extraction.
 */
async function getPendingMetadata(): Promise<string[]> {
  try {
    return await getClient().sendMessage<string[]>('getPendingMetadata');
  } catch (error) {
    safeError('[database.js] Error getting pending metadata:', error);
    return [];
  }
}

/**
 * Filters a list of file paths to only those that need metadata processing.
 * @param filePaths - The list of file paths to check.
 * @returns The filtered list of file paths.
 */
async function filterProcessingNeeded(filePaths: string[]): Promise<string[]> {
  try {
    return await getClient().sendMessage<string[]>('filterProcessingNeeded', {
      filePaths,
    });
  } catch (error) {
    safeError('[database.js] Error filtering processing needed:', error);
    return filePaths; // Fallback to processing all if error
  }
}

async function addTranscodeJob(filePath: string): Promise<void> {
  try {
    await getClient().sendMessage<void>('addTranscodeJob', { filePath });
  } catch (error) {
    safeError('[database.js] Error adding transcode job:', error);
    throw error;
  }
}

async function listTranscodeJobs(): Promise<
  import('../media/types').TranscodeJob[]
> {
  try {
    return await getClient().sendMessage<
      import('../media/types').TranscodeJob[]
    >('listTranscodeJobs');
  } catch (error) {
    safeError('[database.js] Error listing transcode jobs:', error);
    return [];
  }
}

async function updateTranscodeJobStatus(
  filePath: string,
  status: string,
  error: string | null,
): Promise<void> {
  try {
    await getClient().sendMessage<void>('updateTranscodeJobStatus', {
      filePath,
      status,
      error,
    });
  } catch (err) {
    safeError('[database.js] Error updating transcode job status:', err);
  }
}

async function deleteTranscodeJob(filePath: string): Promise<void> {
  try {
    await getClient().sendMessage<void>('deleteTranscodeJob', { filePath });
  } catch (error) {
    safeError('[database.js] Error deleting transcode job:', error);
    throw error;
  }
}

async function getPendingTranscodeJobs(): Promise<string[]> {
  try {
    return await getClient().sendMessage<string[]>('getPendingTranscodeJobs');
  } catch (error) {
    safeError('[database.js] Error getting pending transcode jobs:', error);
    return [];
  }
}
