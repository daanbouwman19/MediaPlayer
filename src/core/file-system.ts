/**
 * @file Provides file system operations for the application core.
 */
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import { isSensitiveFilename } from './security.ts';
import { safeError } from './utils/logger.ts';

export interface FileSystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Lists the contents of a directory.
 * @param directoryPath - The absolute path of the directory to list.
 * @returns A promise that resolves to an array of file system entries.
 */
async function getCanonicalPath(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function getAllowedFsRoots(): Promise<string[]> {
  const configuredRoots = process.env.ALLOWED_FS_ROOTS?.split(',')
    .map((root) => root.trim())
    .filter(Boolean);
  if (configuredRoots && configuredRoots.length > 0) {
    return configuredRoots;
  }
  if (process.platform === 'win32') {
    const drives = await listDrives();
    const drivePaths: string[] = [];
    for (const d of drives) {
      drivePaths.push(d.path);
    }
    return drivePaths;
  }
  return ['/'];
}

function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const relative = path.relative(normalizedRoot, candidatePath);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) &&
      !relative.startsWith('..' + path.sep) &&
      !relative.startsWith('../') &&
      relative !== '..')
  );
}

async function resolveAndValidateDirectoryPath(
  directoryPath: string,
  allowedRootsList: string[],
): Promise<string> {
  const requestedPath = path.resolve(directoryPath);
  const allowedRoots = await Promise.all(
    allowedRootsList.map((root) => getCanonicalPath(root)),
  );

  // 1. Unresolved path check to prevent uncontrolled path I/O (CodeQL alert no. 114)
  const isRequestedPathAllowed = allowedRoots.some((root) =>
    isPathWithinRoot(requestedPath, root),
  );
  if (!isRequestedPathAllowed) {
    throw new Error('Access denied: path is outside allowed roots');
  }

  // 2. Canonical path check to prevent symlink-based traversal bypasses
  const resolvedPath = await fs.realpath(requestedPath);
  const isResolvedPathAllowed = allowedRoots.some((root) =>
    isPathWithinRoot(resolvedPath, root),
  );
  if (!isResolvedPathAllowed) {
    throw new Error('Access denied: path is outside allowed roots');
  }

  return resolvedPath;
}

export async function listDirectory(
  directoryPath: string,
): Promise<FileSystemEntry[]> {
  if (!directoryPath || directoryPath === 'ROOT') {
    return listDrives();
  }

  if (typeof directoryPath !== 'string' || directoryPath.includes('\0')) {
    throw new Error('Invalid directory path');
  }

  try {
    const allowedRootsList = await getAllowedFsRoots();
    const resolvedPath = await resolveAndValidateDirectoryPath(
      directoryPath,
      allowedRootsList,
    );

    const items = await fs.readdir(resolvedPath, { withFileTypes: true });

    // Bolt Optimization: Replace .filter().map() with a for...of loop to avoid
    // creating intermediate arrays and reduce GC pressure for large directories.
    const entries: FileSystemEntry[] = [];
    for (const item of items) {
      // [SECURITY] Filter out hidden files/dirs and known sensitive files to prevent exposing sensitive data (e.g. .env, .git, server.key)
      if (!item.name.startsWith('.') && !isSensitiveFilename(item.name)) {
        entries.push({
          name: item.name,
          path: path.join(resolvedPath, item.name),
          isDirectory: item.isDirectory(),
        });
      }
    }

    // Sort: Directories first, then files. Both alphabetically.
    entries.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) {
        return a.name.localeCompare(b.name);
      }
      return a.isDirectory ? -1 : 1;
    });

    return entries;
  } catch (error) {
    safeError(
      '[file-system.ts] Error listing directory %s:',
      directoryPath,
      error,
    );
    throw error;
  }
}

/**
 * Lists the available drives on Windows.
 * On other platforms, returns the root directory.
 */
export async function listDrives(): Promise<FileSystemEntry[]> {
  if (os.platform() !== 'win32') {
    // For non-Windows, simply return root
    return [
      {
        name: 'Root',
        path: '/',
        isDirectory: true,
      },
    ];
  }

  try {
    const { stdout } = await execa('fsutil', ['fsinfo', 'drives']);
    // Output format: "Drives: C:\ D:\"

    // Remove "Drives:" prefix and split by space
    const drivesLine = stdout.replace('Drives:', '').trim();
    const drivesRaw = drivesLine.split(/\s+/);

    // Bolt Optimization: Replace .filter().map() with a for...of loop to avoid
    // creating intermediate arrays and reduce GC pressure.
    const mappedDrives: FileSystemEntry[] = [];
    for (const drive of drivesRaw) {
      if (drive) {
        mappedDrives.push({
          name: drive.replace(/\\$/, ''), // "C:"
          path: drive, // "C:\" (fsutil returns with backslash)
          isDirectory: true,
        });
      }
    }

    return mappedDrives;
  } catch (error) {
    console.error('Failed to list drives:', error);
    // Fallback to C:\ if fsutil fails
    return [
      {
        name: 'C:',
        path: 'C:\\',
        isDirectory: true,
      },
    ];
  }
}

/**
 * Validates if a path exists and is a directory.
 * @param directoryPath - The path to check.
 * @returns True if it exists and is a directory, false otherwise.
 */
export async function isValidDirectory(
  directoryPath: string,
): Promise<boolean> {
  try {
    const stats = await fs.stat(directoryPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
