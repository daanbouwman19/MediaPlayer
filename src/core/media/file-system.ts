/**
 * @file Provides file system operations for the application core.
 */
import fs from 'fs/promises';
import { realpath as realpathCallback } from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';
import {
  createSensitiveLocationMatcher,
  isRestrictedPath,
  isSensitiveDirectory,
  isSensitiveFilename,
  isUncPath,
  validateInput,
} from '../auth/security.ts';
import { AppError } from './errors.ts';
import { safeError } from './utils/logger.ts';

export interface FileSystemEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Sentinel the directory picker passes for the top level: the drive list in
 * the desktop app, or the allowed roots when browsing is confined.
 */
export const ROOT_DIRECTORY = 'ROOT';

/**
 * Checks whether a listing request is for the top level. This must be checked
 * before a path is resolved or restriction-checked: resolved against the cwd,
 * 'ROOT' would be judged as '<cwd>/ROOT' (e.g. under C:\Program Files).
 */
export function isRootDirectoryRequest(
  directoryPath: string | null | undefined,
): boolean {
  return !directoryPath || directoryPath === ROOT_DIRECTORY;
}

const ACCESS_DENIED_OUTSIDE_ROOTS =
  'Access denied: path is outside allowed roots';
const SENSITIVE_DIRECTORY_MESSAGE =
  'Access restricted for sensitive system directories';

/**
 * Returns the roots browsing is explicitly confined to, or null when it is
 * unconfined (desktop app without ALLOWED_FS_ROOTS).
 */
function getConfiguredFsRoots(): string[] | null {
  const configuredRoots = process.env.ALLOWED_FS_ROOTS?.split(',')
    .map((root) => root.trim())
    .filter(Boolean);
  if (configuredRoots && configuredRoots.length > 0) {
    return configuredRoots;
  }
  // [SECURITY] In web-server mode the /api/fs/* listing endpoints are reachable
  // over the network. Without an explicit allowlist, confine browsing to the
  // user's home directory rather than exposing every drive / the filesystem
  // root. Operators can still broaden this with ALLOWED_FS_ROOTS. The Electron
  // desktop build never sets MEDIAPLAYER_WEB_MODE, so its local directory
  // picker keeps full access.
  if (process.env.MEDIAPLAYER_WEB_MODE === '1') {
    return [os.homedir()];
  }
  return null;
}

async function getAllowedFsRoots(): Promise<string[]> {
  const configuredRoots = getConfiguredFsRoots();
  if (configuredRoots) {
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

function realpathJs(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    realpathCallback(p, (err, resolved) => {
      if (err) reject(err);
      else resolve(resolved);
    });
  });
}

/**
 * Resolves symlinks like fs.promises.realpath, but keeps the drive letter of
 * a mapped network drive. The native realpath expands Z:\Movies to its UNC
 * target (\\nas\share\Movies), which no longer matches the drive-letter based
 * allowed roots and is rejected as a UNC path. The JS realpath still follows
 * symlinks and junctions, so a link pointing elsewhere is still caught.
 */
export async function canonicalizePath(p: string): Promise<string> {
  const real = await fs.realpath(p);
  if (process.platform === 'win32' && isUncPath(real) && !isUncPath(p)) {
    return realpathJs(p);
  }
  return real;
}

/**
 * Canonicalises the allowed roots. Calling realpath here is safe because the
 * values come from configuration / the drive list, not from the request.
 */
async function getCanonicalAllowedRoots(): Promise<string[]> {
  const allowedRootsList = await getAllowedFsRoots();
  const allowedRoots = await Promise.all(
    allowedRootsList.map(async (root) => {
      const r = path.resolve(root);
      try {
        return await canonicalizePath(r);
      } catch {
        return r;
      }
    }),
  );
  return allowedRoots.filter((root) => path.isAbsolute(root));
}

function isSamePath(a: string, b: string): boolean {
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b;
}

async function resolveAndValidateDirectoryPath(
  directoryPath: string,
  allowedRoots: string[],
): Promise<string> {
  const requestedPath = path.resolve(directoryPath);

  if (allowedRoots.length === 0) {
    throw new AppError(403, 'Access denied: no valid allowed roots configured');
  }

  // 1. Pre-symlink check: inline startsWith so CodeQL js/path-injection
  //    sees the guard directly on requestedPath (a custom helper function
  //    is not modelled as a sanitiser barrier by static-analysis tools).
  let matchingRoot: string | undefined;
  for (const root of allowedRoots) {
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    if (requestedPath === root || requestedPath.startsWith(prefix)) {
      matchingRoot = root;
      break;
    }
  }
  if (!matchingRoot) {
    throw new AppError(403, ACCESS_DENIED_OUTSIDE_ROOTS);
  }

  // 2. Resolve symlinks so that a symlink pointing outside the root is caught.
  //    Compute the relative segment and guard it against traversal before
  //    anchoring to the trusted root — path.resolve(trustedRoot, relPath) is
  //    the pattern CodeQL js/path-injection recognises as a sanitiser barrier.
  const relPath = path.relative(matchingRoot, requestedPath);
  if (
    relPath === '..' ||
    relPath.startsWith('..' + path.sep) ||
    path.isAbsolute(relPath)
  ) {
    throw new AppError(403, ACCESS_DENIED_OUTSIDE_ROOTS);
  }
  let canonicalPath: string;
  try {
    canonicalPath = await canonicalizePath(path.resolve(matchingRoot, relPath));
  } catch {
    throw new AppError(403, ACCESS_DENIED_OUTSIDE_ROOTS);
  }

  // 3. Post-symlink containment check using startsWith — catches symlinks
  //    that point outside the allowed root.
  const rootPrefix = matchingRoot.endsWith(path.sep)
    ? matchingRoot
    : matchingRoot + path.sep;
  if (canonicalPath !== matchingRoot && !canonicalPath.startsWith(rootPrefix)) {
    throw new AppError(403, ACCESS_DENIED_OUTSIDE_ROOTS);
  }

  return canonicalPath;
}

/**
 * Lists the top level of the directory picker. Unconfined, that is the drive
 * list (re-read so newly connected drives appear). Confined, it is the allowed
 * roots themselves, canonicalised so they can be listed and navigated.
 */
async function listRootEntries(): Promise<FileSystemEntry[]> {
  const configuredRoots = getConfiguredFsRoots();
  if (!configuredRoots) {
    return listDrives({ refresh: true });
  }

  const entries: FileSystemEntry[] = [];
  const seen = new Set<string>();
  for (const root of configuredRoots) {
    let canonicalRoot: string;
    try {
      canonicalRoot = await canonicalizePath(path.resolve(root));
      if (!(await fs.stat(canonicalRoot)).isDirectory()) continue;
    } catch {
      // A configured root that does not exist (yet) is simply not listed.
      continue;
    }
    if (seen.has(canonicalRoot)) continue;
    seen.add(canonicalRoot);
    entries.push({
      name: canonicalRoot,
      path: canonicalRoot,
      isDirectory: true,
    });
  }
  return entries;
}

/**
 * Lists a directory for the directory picker. Shared by the Electron IPC
 * handler and the web route, so the 'ROOT' sentinel, the restricted-path check
 * and the allowed-root confinement are applied identically in both modes.
 * @throws AppError 400 for an invalid path, 403 when access is denied.
 */
export async function listDirectory(
  directoryPath: string,
): Promise<FileSystemEntry[]> {
  if (isRootDirectoryRequest(directoryPath)) {
    return listRootEntries();
  }

  if (typeof directoryPath !== 'string' || directoryPath.includes('\0')) {
    throw new AppError(400, 'Invalid directory path');
  }

  if (isRestrictedPath(directoryPath)) {
    console.warn(
      `[Security] Blocked attempt to list restricted directory: ${directoryPath}`,
    );
    throw new AppError(403, 'Access denied');
  }

  try {
    const resolvedPath = await resolveAndValidateDirectoryPath(
      directoryPath,
      await getCanonicalAllowedRoots(),
    );

    const items = await fs.readdir(resolvedPath, { withFileTypes: true });

    // Replace .filter().map() with a for...of loop to avoid
    // creating intermediate arrays and reduce GC pressure for large directories.
    const entries: FileSystemEntry[] = [];
    const isInSensitiveLocation = createSensitiveLocationMatcher();
    for (const item of items) {
      // [SECURITY] Filter out hidden files/dirs and known sensitive files to prevent exposing sensitive data (e.g. .env, .git, server.key)
      if (item.name.startsWith('.') || isSensitiveFilename(item.name)) {
        continue;
      }
      const entryPath = path.join(resolvedPath, item.name);
      // [SECURITY] Hide per-user data folders such as <profile>\AppData.
      if (isInSensitiveLocation(entryPath)) {
        continue;
      }
      entries.push({
        name: item.name,
        path: entryPath,
        isDirectory: item.isDirectory(),
      });
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
 * Returns the directory the picker navigates "up" to, or null when the path
 * is already top-level: a drive / filesystem root, or one of the allowed
 * roots. The picker then goes back to the root listing instead of to a parent
 * it is not allowed to list.
 */
export async function getParentDirectory(
  directoryPath: string,
): Promise<string | null> {
  if (isRootDirectoryRequest(directoryPath)) return null;

  const parent = path.dirname(directoryPath);
  if (parent === directoryPath) return null;

  const configuredRoots = getConfiguredFsRoots();
  if (configuredRoots) {
    const resolved = path.resolve(directoryPath);
    const roots = await getCanonicalAllowedRoots();
    for (const root of configuredRoots) {
      roots.push(path.resolve(root));
    }
    if (roots.some((root) => isSamePath(root, resolved))) return null;
  }
  return parent;
}

/**
 * Validates a local folder the user wants to add as a media source and
 * returns the canonical path to store. Adding applies the same confinement as
 * browsing: the folder must exist, must not be a sensitive system location,
 * and must lie inside the allowed roots (ALLOWED_FS_ROOTS, or the home
 * directory in web-server mode).
 * @throws AppError 400 for an invalid or missing folder, 403 when denied.
 */
export async function resolveMediaSourceDirectory(
  directoryPath: string,
): Promise<string> {
  const inputResult = validateInput(directoryPath);
  if (inputResult) {
    throw new AppError(400, inputResult.message || 'Invalid path');
  }
  if (!path.isAbsolute(directoryPath)) {
    throw new AppError(400, 'Invalid path');
  }

  if (isSensitiveDirectory(directoryPath)) {
    console.warn(
      `[Security] Blocked attempt to add sensitive directory: ${directoryPath}`,
    );
    throw new AppError(403, SENSITIVE_DIRECTORY_MESSAGE);
  }

  let resolvedPath: string;
  try {
    // Resolve symlinks to prevent bypass of the sensitive directory check.
    resolvedPath = await canonicalizePath(directoryPath);
  } catch {
    throw new AppError(400, 'Directory does not exist');
  }

  if (isSensitiveDirectory(resolvedPath)) {
    console.warn(
      `[Security] Blocked attempt to add sensitive directory: ${directoryPath} (resolved to ${resolvedPath})`,
    );
    throw new AppError(403, SENSITIVE_DIRECTORY_MESSAGE);
  }

  const confinedPath = await resolveAndValidateDirectoryPath(
    resolvedPath,
    await getCanonicalAllowedRoots(),
  );

  if (!(await fs.stat(confinedPath)).isDirectory()) {
    throw new AppError(400, 'Not a directory');
  }
  return confinedPath;
}

/**
 * Lists the available drives on Windows.
 * On other platforms, returns the root directory.
 */
// Drives come and go (USB disks, mapped shares), so the list is only reused
// briefly; the picker's root listing always re-reads it.
const DRIVES_CACHE_TTL_MS = 10_000;
let cachedDrives: { entries: FileSystemEntry[]; time: number } | null = null;
let pendingDrives: Promise<FileSystemEntry[]> | null = null;

export function clearDrivesCache(): void {
  cachedDrives = null;
}

async function readDrives(): Promise<FileSystemEntry[]> {
  try {
    const { stdout } = await execa('fsutil', ['fsinfo', 'drives']);
    // Output format: "Drives: C:\ D:\"

    // Remove "Drives:" prefix and split by space
    const drivesLine = stdout.replace('Drives:', '').trim();
    const drivesRaw = drivesLine.split(/\s+/);

    // Replace .filter().map() with a for...of loop to avoid
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
    if (mappedDrives.length === 0) {
      throw new Error(`Unexpected fsutil output: ${stdout}`);
    }

    cachedDrives = { entries: mappedDrives, time: Date.now() };
    return mappedDrives;
  } catch (error) {
    console.error('Failed to list drives:', error);
    // Fall back to C:\, but do not cache the fallback so the next call
    // retries fsutil instead of hiding every other drive until a restart.
    return [
      {
        name: 'C:',
        path: 'C:\\',
        isDirectory: true,
      },
    ];
  }
}

export async function listDrives(
  options: { refresh?: boolean } = {},
): Promise<FileSystemEntry[]> {
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

  if (
    !options.refresh &&
    cachedDrives &&
    Date.now() - cachedDrives.time < DRIVES_CACHE_TTL_MS
  ) {
    return cachedDrives.entries;
  }

  if (!pendingDrives) {
    pendingDrives = readDrives().finally(() => {
      pendingDrives = null;
    });
  }
  return pendingDrives;
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
    const resolvedPath = await resolveAndValidateDirectoryPath(
      directoryPath,
      await getCanonicalAllowedRoots(),
    );
    const stats = await fs.stat(resolvedPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
