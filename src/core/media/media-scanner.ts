/**
 * @file Provides functionality to scan the filesystem for media files.
 * This module is responsible for finding all supported media files within a
 * given directory structure and organizing them into a hierarchical tree of "albums".
 * @requires fs/promises
 * @requires path
 * @requires ./constants.js
 */
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import {
  ALL_SUPPORTED_EXTENSIONS_SET,
  DISK_SCAN_CONCURRENCY,
} from './constants.ts';
import { isIgnoredDirectory } from '../auth/security.ts';
import { isDrivePath, getDriveId } from './media-utils.ts';
import type { Album, MediaFile } from './types.ts';
import { listDriveFiles } from '../../main/google-drive-service.ts';
import { ConcurrencyLimiter } from './utils/concurrency-limiter.ts';
import { safeLog, safeError } from './utils/logger.ts';

// Limit concurrent file system scans to avoid EMFILE errors
// Note: This limit applies only to the `readdir` call itself, not the whole recursion.
const scanLimiter = new ConcurrencyLimiter(DISK_SCAN_CONCURRENCY);

/**
 * Processes a single file entry from a directory scan.
 * Checks extension and returns a MediaFile if supported.
 */
function processFileItem(
  item: Dirent,
  directoryPath: string,
  knownPaths?: Set<string>,
): MediaFile | null {
  if (!item.isFile()) return null;

  const fileExtension = path.extname(item.name).toLowerCase();

  // Bolt Optimization: Set.has is O(1) vs Array.includes O(N)
  if (!ALL_SUPPORTED_EXTENSIONS_SET.has(fileExtension)) return null;

  const fullPath = path.join(directoryPath, item.name);

  // Only log if it's a new file (not in knownPaths)
  if (!knownPaths || !knownPaths.has(fullPath)) {
    safeLog(`[MediaScanner] Found file: ${fullPath}`);
  }

  return { name: item.name, path: fullPath };
}

/**
 * Separates directory entries into media files and child directory promises.
 */
function processDirectoryEntries(
  items: Dirent[],
  directoryPath: string,
  knownPaths?: Set<string>,
): { textures: MediaFile[]; childrenPromises: Promise<Album | null>[] } {
  const textures: MediaFile[] = [];
  const childrenPromises: Promise<Album | null>[] = [];

  for (const item of items) {
    if (item.isDirectory()) {
      if (isIgnoredDirectory(item.name)) {
        continue;
      }
      const fullPath = path.join(directoryPath, item.name);
      childrenPromises.push(scanDirectoryRecursive(fullPath, knownPaths));
    } else {
      const mediaFile = processFileItem(item, directoryPath, knownPaths);
      if (mediaFile) {
        textures.push(mediaFile);
      }
    }
  }

  return { textures, childrenPromises };
}

/**
 * Asynchronously and recursively scans a directory to build a hierarchical album structure.
 * An album is created for any directory that contains media files or has subdirectories
 * that contain media files.
 * @param directoryPath - The absolute path to the directory to scan.
 * @returns A promise that resolves to an Album object if media is found, otherwise null.
 */
async function scanDirectoryRecursive(
  directoryPath: string,
  knownPaths?: Set<string>,
): Promise<Album | null> {
  try {
    // Only wrap the readdir call to limit concurrent open file descriptors.
    // We do NOT wrap the recursive calls or the whole function, as that would cause a deadlock
    // (parent holding a slot while waiting for children).
    const items = await scanLimiter.run(() =>
      fs.readdir(directoryPath, { withFileTypes: true }),
    );

    const { textures, childrenPromises } = processDirectoryEntries(
      items,
      directoryPath,
      knownPaths,
    );

    const children = (await Promise.all(childrenPromises)).filter(
      (child): child is Album => child !== null,
    );

    if (textures.length > 0 || children.length > 0) {
      safeLog(
        `[MediaScanner] Folder: ${path.basename(directoryPath)} - Files: ${textures.length}`,
      );
      return {
        id: directoryPath,
        name: path.basename(directoryPath),
        textures,
        children,
      };
    }
  } catch (err: unknown) {
    safeError(
      `[media-scanner.js] Error reading directory ${directoryPath}:`,
      (err as Error).message,
    );
  }
  return null;
}

/**
 * Scans a Google Drive folder.
 * @param folderId - The Google Drive folder ID.
 */
async function scanGoogleDrive(folderId: string): Promise<Album | null> {
  try {
    // Our service already does recursive or flat listing and returns an Album
    const album = await listDriveFiles(folderId);
    // If it's empty, we might want to return null, but for now let's return it
    if (album.textures.length > 0 || album.children.length > 0) {
      return album;
    }
    return null;
  } catch (err) {
    safeError(
      `[media-scanner.js] Error scanning Google Drive folder ${folderId}:`,
      err,
    );
    return null;
  }
}

/**
 * Scans a single root directory (either Google Drive or local filesystem).
 * Handles access checks and delegates to the appropriate scanner.
 */
async function scanRootDirectory(
  baseDir: string,
  knownPaths?: Set<string>,
): Promise<Album | null> {
  try {
    if (isDrivePath(baseDir)) {
      const folderId = getDriveId(baseDir);
      return await scanGoogleDrive(folderId);
    } else {
      await fs.access(baseDir);
      return await scanDirectoryRecursive(baseDir, knownPaths);
    }
  } catch (dirError: unknown) {
    safeError(
      `[media-scanner.js] Error accessing or scanning directory ${baseDir}: ${(dirError as Error).message}`,
    );
    return null;
  }
}

/**
 * Performs a full scan for each base directory and returns a distinct album structure for each.
 * It no longer merges albums with the same root name from different sources.
 * @param baseMediaDirectories - An array of root directories to scan.
 * @returns A promise that resolves to an array of root album objects. Returns an empty array on failure.
 */
async function performFullMediaScan(
  baseMediaDirectories: string[],
  knownPaths?: Set<string>,
): Promise<Album[]> {
  safeLog(
    `[media-scanner.js] Starting disk scan in directories:`,
    baseMediaDirectories,
  );

  try {
    const scanPromises = baseMediaDirectories.map((baseDir) =>
      scanRootDirectory(baseDir, knownPaths),
    );

    const result = (await Promise.all(scanPromises)).filter(
      (album): album is Album => album !== null,
    );

    const countFiles = (albums: Album[]): number => {
      // Bolt Optimization: Replace recursive reduce with an iterative stack
      // to prevent stack overflows on deeply nested directories and reduce GC pressure.
      let count = 0;
      const stack: Album[] = albums.slice();
      while (stack.length > 0) {
        const album = stack.pop()!;
        count += album.textures.length;
        for (const child of album.children) {
          stack.push(child);
        }
      }
      return count;
    };

    const totalFiles = countFiles(result);
    safeLog(
      `[media-scanner.js] Found ${result.length} root albums with ${totalFiles} total files.`,
    );
    return result;
  } catch (e) {
    safeError(`[media-scanner.js] Error scanning disk for albums:`, e);
    return [];
  }
}

export { performFullMediaScan };
