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

/**
 * Returns true when `candidatePath` is the same as, or a descendant of,
 * `rootPath`.  Appending `path.sep` to the root prevents the
 * `/allowed` vs `/allowed2` false-positive while still allowing any
 * directory name that starts with `..` (e.g. `..foo`) because those
 * resolve to a child path that begins with `<root>/`.
 */
function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const rootPrefix = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;
  const normalizedCandidate = path.resolve(candidatePath);
  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(rootPrefix)
  );
}

async function resolveAndValidateDirectoryPath(
  directoryPath: string,
  allowedRootsList: string[],
): Promise<string> {
  const requestedPath = path.resolve(directoryPath);

  // Canonicalise each allowed root (trusted data: env var / drive list, not
  // user input).  Calling fs.realpath here is safe because the values come
  // from configuration, not from the HTTP request.
  const allowedRoots = (
    await Promise.all(
      allowedRootsList.map(async (root) => {
        const r = path.resolve(root);
        try {
          return await fs.realpath(r);
        } catch {
          return r;
        }
      }),
    )
  ).filter((root) => path.isAbsolute(root));

  if (allowedRoots.length === 0) {
    throw new Error('Access denied: no valid allowed roots configured');
  }

  // 1. Pre-symlink check: reject obviously out-of-bounds paths without
  //    touching the file system for the user-provided value.
  const matchingRoot = allowedRoots.find((root) =>
    isPathWithinRoot(requestedPath, root),
  );
  if (!matchingRoot) {
    throw new Error('Access denied: path is outside allowed roots');
  }

  // 2. Resolve symlinks so that a symlink pointing outside the root is caught.
  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(requestedPath);
  } catch {
    throw new Error('Access denied: path is outside allowed roots');
  }

  // 3. Post-symlink containment check using startsWith – this is the pattern
  //    recognised by static-analysis tools (e.g. CodeQL js/path-injection) as
  //    a sanitizer barrier.  Code that uses `canonicalPath` after this point
  //    is considered safe because it can only be reached when the resolved
  //    path is provably within `matchingRoot`.
  const rootPrefix = matchingRoot.endsWith(path.sep)
    ? matchingRoot
    : matchingRoot + path.sep;
  if (canonicalPath !== matchingRoot && !canonicalPath.startsWith(rootPrefix)) {
    throw new Error('Access denied: path is outside allowed roots');
  }

  return canonicalPath;
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
let cachedDrives: FileSystemEntry[] | null = null;

export function clearDrivesCache(): void {
  cachedDrives = null;
}

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

  if (cachedDrives) {
    return cachedDrives;
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

    cachedDrives = mappedDrives;
    return mappedDrives;
  } catch (error) {
    console.error('Failed to list drives:', error);
    // Fallback to C:\ if fsutil fails
    const fallback = [
      {
        name: 'C:',
        path: 'C:\\',
        isDirectory: true,
      },
    ];
    cachedDrives = fallback;
    return fallback;
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
  if (typeof directoryPath !== 'string' || directoryPath.includes('\0')) {
    return false;
  }
  try {
    const allowedRootsList = await getAllowedFsRoots();
    const resolvedPath = await resolveAndValidateDirectoryPath(
      directoryPath,
      allowedRootsList,
    );
    const stats = await fs.stat(resolvedPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
