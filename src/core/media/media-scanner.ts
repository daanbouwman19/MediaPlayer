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
import { isIgnoredDirectory, isSensitiveFilename } from '../auth/security.ts';
import { isDrivePath, getDriveId } from './media-utils.ts';
import type { Album, MediaFile } from './types.ts';
import { getDriveBackend } from './drive-backend.ts';
import { ConcurrencyLimiter } from './utils/concurrency-limiter.ts';
import { safeLog, safeError } from './utils/logger.ts';

// Limit concurrent file system scans to avoid EMFILE errors
// Note: This limit applies only to the `readdir` call itself, not the whole recursion.
const scanLimiter = new ConcurrencyLimiter(DISK_SCAN_CONCURRENCY);

/**
 * Housekeeping folders that operating systems and NAS devices create on
 * volumes. Their contents (deleted files, restore points, generated
 * thumbnails) are not part of the user's library. Compared lower-case.
 */
const SYSTEM_FOLDER_NAMES = new Set([
  '$recycle.bin',
  '$windows.~bt',
  '$windows.~ws',
  'recycler',
  'recycled',
  'system volume information',
  // Synology/QNAP recycle bins and generated thumbnails
  '#recycle',
  '@eadir',
  '@recycle',
]);

/**
 * Returns true for directories the scan must not descend into: hidden and
 * sensitive directories, plus OS/NAS housekeeping folders.
 */
function isSkippedDirectory(name: string, fullPath: string): boolean {
  return (
    isIgnoredDirectory(name, fullPath) ||
    SYSTEM_FOLDER_NAMES.has(name.toLowerCase())
  );
}

/**
 * Processes a single file entry from a directory scan.
 * Checks extension and returns a MediaFile if supported.
 */
function processFileItem(
  item: Dirent,
  directoryPath: string,
): MediaFile | null {
  if (!item.isFile()) return null;

  // Hidden files (including macOS '._*' AppleDouble companions) and
  // sensitive files are refused by authorization, so never index them.
  if (item.name.startsWith('.') || isSensitiveFilename(item.name)) {
    return null;
  }

  const fileExtension = path.extname(item.name).toLowerCase();

  // Set.has is O(1) vs Array.includes O(N)
  if (!ALL_SUPPORTED_EXTENSIONS_SET.has(fileExtension)) return null;

  return { name: item.name, path: path.join(directoryPath, item.name) };
}

/**
 * Separates directory entries into media files and child directory promises.
 */
function processDirectoryEntries(
  items: Dirent[],
  directoryPath: string,
): { textures: MediaFile[]; childrenPromises: Promise<Album | null>[] } {
  const textures: MediaFile[] = [];
  const childrenPromises: Promise<Album | null>[] = [];

  for (const item of items) {
    if (item.isDirectory()) {
      const fullPath = path.join(directoryPath, item.name);
      if (isSkippedDirectory(item.name, fullPath)) {
        continue;
      }
      childrenPromises.push(scanDirectoryRecursive(fullPath));
    } else {
      const mediaFile = processFileItem(item, directoryPath);
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
    );

    const children = (await Promise.all(childrenPromises)).filter(
      (child): child is Album => child !== null,
    );

    if (textures.length > 0 || children.length > 0) {
      return {
        id: directoryPath,
        // A drive root such as D:\ has no basename; show the path instead.
        name: path.basename(directoryPath) || directoryPath,
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
    const album = await getDriveBackend().listFolder(folderId);
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
async function scanRootDirectory(baseDir: string): Promise<Album | null> {
  try {
    if (isDrivePath(baseDir)) {
      const folderId = getDriveId(baseDir);
      return await scanGoogleDrive(folderId);
    } else {
      await fs.access(baseDir);
      return await scanDirectoryRecursive(baseDir);
    }
  } catch (dirError: unknown) {
    safeError(
      `[media-scanner.js] Error accessing or scanning directory ${baseDir}: ${(dirError as Error).message}`,
    );
    return null;
  }
}

/**
 * Counts the media files in an album tree.
 * Uses an iterative stack to prevent stack overflows on deeply nested
 * directories and reduce GC pressure.
 */
function countFiles(albums: Album[]): number {
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
}

/**
 * Drops files already listed under an earlier album, so one file never
 * appears (and is weighted) twice in the library, e.g. when two sources
 * overlap or a Drive folder is reachable from two roots. Albums emptied by
 * this are pruned; albums that were already empty are left alone.
 * Mutates the tree in place and returns the remaining roots.
 */
function removeDuplicateFiles(roots: Album[]): Album[] {
  const seen = new Set<string>();
  const shrunk = new Set<Album>();
  const preOrder: Album[] = [];
  const stack: Album[] = [];
  for (let i = roots.length - 1; i >= 0; i--) {
    const root = roots[i];
    if (root) stack.push(root);
  }

  while (stack.length > 0) {
    const album = stack.pop()!;
    preOrder.push(album);

    // Only copy the textures array once a duplicate is actually found.
    const textures = album.textures;
    let unique: MediaFile[] | null = null;
    for (let i = 0; i < textures.length; i++) {
      const texture = textures[i]!;
      if (seen.has(texture.path)) {
        unique ??= textures.slice(0, i);
        continue;
      }
      seen.add(texture.path);
      unique?.push(texture);
    }
    if (unique) {
      album.textures = unique;
      shrunk.add(album);
    }

    for (let i = album.children.length - 1; i >= 0; i--) {
      const child = album.children[i];
      if (child) stack.push(child);
    }
  }

  if (shrunk.size === 0) return roots;

  const isPrunable = (album: Album) =>
    shrunk.has(album) &&
    album.textures.length === 0 &&
    album.children.length === 0;

  // Reverse pre-order visits children before their parents, so emptiness
  // propagates upwards.
  for (let i = preOrder.length - 1; i >= 0; i--) {
    const album = preOrder[i]!;
    const remaining = album.children.filter((child) => !isPrunable(child));
    if (remaining.length !== album.children.length) {
      album.children = remaining;
      shrunk.add(album);
    }
  }
  return roots.filter((root) => !isPrunable(root));
}

/**
 * Performs a full scan for each base directory and returns a distinct album structure for each.
 * It no longer merges albums with the same root name from different sources.
 * @param baseMediaDirectories - An array of root directories to scan.
 * @returns A promise that resolves to an array of root album objects. Returns an empty array on failure.
 */
async function performFullMediaScan(
  baseMediaDirectories: string[],
): Promise<Album[]> {
  safeLog(
    `[media-scanner.js] Starting disk scan in directories:`,
    baseMediaDirectories,
  );

  try {
    const scanned = await Promise.all(
      baseMediaDirectories.map((baseDir) => scanRootDirectory(baseDir)),
    );

    // Log one line per source rather than per file or folder: a large
    // library would otherwise write hundreds of thousands of lines.
    const roots: Album[] = [];
    for (let i = 0; i < scanned.length; i++) {
      const album = scanned[i];
      if (!album) continue;
      roots.push(album);
      safeLog(
        `[media-scanner.js] Scanned ${baseMediaDirectories[i]}: ${countFiles([album])} files.`,
      );
    }

    const result = removeDuplicateFiles(roots);

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
