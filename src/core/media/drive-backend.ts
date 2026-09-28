/**
 * @file Port for the Google Drive integration used by the core media layer.
 *
 * src/core is shared by the Electron main process, the web server and the scan
 * worker, so it must not import from src/main or src/server (see CLAUDE.md).
 * The concrete implementation (googleapis client, OAuth credentials and the
 * on-disk download cache) is registered at startup by each composition root
 * through {@link registerDriveBackend}.
 */
import type { Readable } from 'stream';
import type { drive_v3 } from 'googleapis';
import type { Credentials } from 'google-auth-library';
import type { Album } from './types.ts';

export type DriveFileMetadata = drive_v3.Schema$File;

export interface DriveByteRange {
  start?: number;
  end?: number;
}

/** The local copy of a Drive file, which may still be downloading. */
export interface DriveCachedFile {
  /**
   * Path of the cache file; it holds a prefix of the Drive file, encrypted,
   * with the same length as the plaintext.
   */
  path: string;
  /** Size of the Drive file the cache is downloading, in bytes. */
  totalSize: number;
  /** Reads the inclusive byte range [start, end] of the file, decrypted. */
  readRange(start: number, end: number): Readable;
}

export interface DriveBackend {
  /** Fetches the file's metadata (name, MIME type, size, ...). */
  getFileMetadata(fileId: string): Promise<DriveFileMetadata>;
  /** Downloads the file, or an inclusive byte range of it. */
  getFileStream(fileId: string, range?: DriveByteRange): Promise<Readable>;
  /** Lists a Drive folder as an album tree (used by the scanner). */
  listFolder(folderId: string): Promise<Album>;
  /** Installs OAuth tokens handed over by another thread. */
  setCredentials(tokens: Credentials): void;
  /** Returns the local cache file, starting a background download if needed. */
  getCachedFile(fileId: string): Promise<DriveCachedFile>;
}

let backend: DriveBackend | null = null;

/** Registers the Drive implementation. Called once by each composition root. */
export function registerDriveBackend(implementation: DriveBackend): void {
  backend = implementation;
}

/** Returns the registered Drive implementation. */
export function getDriveBackend(): DriveBackend {
  if (!backend) {
    throw new Error('Google Drive backend has not been registered.');
  }
  return backend;
}

/** Removes the registered implementation. Intended for test isolation only. */
export function resetDriveBackend(): void {
  backend = null;
  metadataCache.clear();
}

/**
 * Shared, TTL-bounded Drive metadata cache.
 *
 * Every streamed Drive request needs the file's size and MIME type. A media
 * source is created per request and the internal proxy serves each ffmpeg
 * range request separately, so without a shared cache every seek paid for an
 * uncached files.get round trip. The TTL keeps revisions made on Drive
 * visible within a few minutes; failed lookups are not cached.
 */
const METADATA_TTL_MS = 5 * 60 * 1000;
const METADATA_CACHE_MAX_ENTRIES = 500;

interface MetadataEntry {
  expiresAt: number;
  promise: Promise<DriveFileMetadata>;
}

const metadataCache = new Map<string, MetadataEntry>();

/** Returns the file's metadata, served from the shared cache when fresh. */
export function getDriveFileMetadataCached(
  fileId: string,
): Promise<DriveFileMetadata> {
  const now = Date.now();
  const cached = metadataCache.get(fileId);
  if (cached && cached.expiresAt > now) {
    // Refresh the LRU position (Map iteration order is insertion order).
    metadataCache.delete(fileId);
    metadataCache.set(fileId, cached);
    return cached.promise;
  }

  const promise = getDriveBackend().getFileMetadata(fileId);
  const entry: MetadataEntry = { expiresAt: now + METADATA_TTL_MS, promise };
  metadataCache.delete(fileId);
  metadataCache.set(fileId, entry);
  promise.catch(() => {
    // Only drop our own entry: a newer lookup may have replaced it already.
    if (metadataCache.get(fileId) === entry) metadataCache.delete(fileId);
  });

  while (metadataCache.size > METADATA_CACHE_MAX_ENTRIES) {
    const oldest = metadataCache.keys().next();
    if (oldest.done) break;
    metadataCache.delete(oldest.value);
  }
  return promise;
}

/** Drops a file's cached metadata, e.g. after it changed on Drive. */
export function invalidateDriveFileMetadata(fileId: string): void {
  metadataCache.delete(fileId);
}

/**
 * Parses the Drive `size` field. Drive reports it as a decimal string and
 * omits it for Google Docs types, which have no downloadable bytes.
 */
export function parseDriveFileSize(meta: DriveFileMetadata): number {
  const size = Number(meta.size);
  if (meta.size == null || !Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Drive file ${meta.id ?? ''} has no downloadable size`);
  }
  return size;
}
