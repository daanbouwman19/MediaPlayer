import fs from 'fs/promises';
import { realpathSync } from 'fs';
import path from 'path';
import { getMediaDirectories, isFileInLibrary } from '../database/database.ts';
import type { MediaDirectory } from '../media/types.ts';
import { isDrivePath } from '../media/media-utils.ts';
import { ConcurrencyLimiter } from '../media/utils/concurrency-limiter.ts';
import {
  SENSITIVE_SUBDIRECTORIES,
  SSH_KEY_PREFIXES,
  SENSITIVE_FILE_PREFIXES,
  WINDOWS_RESTRICTED_ROOT_PATHS,
  MAX_PATH_LENGTH,
  DISK_SCAN_CONCURRENCY,
} from '../media/constants.ts';

export interface AuthorizationResult {
  isAllowed: boolean;
  realPath?: string;
  message?: string;
}

// Bolt Optimization: Cache for authorization results to avoid redundant fs.realpath calls
// and DB queries for high-frequency checks (e.g., HLS streaming).
const authCache = new Map<string, { res: AuthorizationResult; time: number }>();
const CACHE_TTL_MS = 5000;
const CACHE_MAX_SIZE = 2000;

function cacheAuthResult(filePath: string, result: AuthorizationResult) {
  // Maintain LRU-like behavior: re-insert if exists to update order
  if (authCache.has(filePath)) {
    authCache.delete(filePath);
  }
  authCache.set(filePath, { res: result, time: Date.now() });

  // Simple cleanup to prevent unbounded growth (evict oldest)
  if (authCache.size > CACHE_MAX_SIZE) {
    const firstKey = authCache.keys().next().value;
    if (firstKey) authCache.delete(firstKey);
  }
}

export function clearAuthCache() {
  authCache.clear();
}

interface ErrnoException extends Error {
  errno?: number;
  code?: string;
  path?: string;
  syscall?: string;
}

function isErrnoException(error: unknown): error is ErrnoException {
  return (
    error instanceof Error && typeof (error as ErrnoException).code === 'string'
  );
}

// Mutable set of sensitive directories, initialized with defaults.
// Ensure all initial values are lowercase for case-insensitive checks.
const sensitiveSubdirectoriesSet = new Set(
  Array.from(SENSITIVE_SUBDIRECTORIES).map((d) => d.toLowerCase()),
);

/**
 * Registers a new sensitive file or directory name to block.
 * @param filename - The name of the file or directory.
 */
export function registerSensitiveFile(filename: string): void {
  if (!filename) return;
  sensitiveSubdirectoriesSet.add(filename.toLowerCase());
}

/**
 * Loads security configuration from a JSON file to extend sensitive directories.
 * @param configPath - Path to the security configuration file.
 */
export async function loadSecurityConfig(configPath: string): Promise<void> {
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(content);
    if (
      Array.isArray(config.sensitiveSubdirectories) &&
      config.sensitiveSubdirectories.every(
        (i: unknown) => typeof i === 'string',
      )
    ) {
      for (const dir of config.sensitiveSubdirectories) {
        registerSensitiveFile(dir);
      }
      console.log(
        `[Security] Loaded ${config.sensitiveSubdirectories.length} custom sensitive directories.`,
      );
    }
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') {
      // Ignore missing config file, use defaults.
      return;
    }

    console.warn(
      `[Security] Failed to load security config from ${configPath}:`,
      error,
    );
    throw error;
  }
}

/**
 * Validates if a file path is within the allowed media directories.
 * @param filePath - The path to validate.
 * @returns Authorization result containing allowed status, resolved path, or error/denied message.
 */
/**
 * Filters a list of file paths, returning only those authorized.
 * Fetches media directories once to optimize performance.
 */
export async function filterAuthorizedPaths(
  filePaths: string[],
): Promise<string[]> {
  if (filePaths.length > 1) {
    await getMediaDirectories();
  }

  const limiter = new ConcurrencyLimiter(DISK_SCAN_CONCURRENCY);

  const results = await Promise.all(
    filePaths.map((p) =>
      limiter.run(async () => {
        const auth = await authorizeFilePath(p);
        return auth.isAllowed ? (auth.realPath ?? p) : null;
      }),
    ),
  );
  return results.filter((p): p is string => p !== null);
}

export async function authorizeFilePath(
  filePath: string,
  mediaDirectories?: MediaDirectory[],
): Promise<AuthorizationResult> {
  const inputResult = validateInput(filePath);
  if (inputResult) return inputResult;

  // Only fetch media directories once per call it is needed. Wait until cache is checked.

  if (!mediaDirectories) {
    const cached = authCache.get(filePath);
    if (cached) {
      if (Date.now() - cached.time < CACHE_TTL_MS) {
        authCache.delete(filePath);
        authCache.set(filePath, cached);
        return cached.res;
      }
      authCache.delete(filePath);
    }
  }

  const dirs = mediaDirectories || (await getMediaDirectories());
  const allowedPaths = dirs.map((d) => d.path);

  let result: AuthorizationResult;

  if (isDrivePath(filePath)) {
    result = (await authorizeVirtualPath(filePath)) ?? {
      isAllowed: false,
      message: 'Access denied',
    };
  } else {
    const localResult = await authorizeLocalPath(filePath, allowedPaths);
    if (localResult) {
      result = localResult;
    } else {
      // No allowed directory produced a valid real path
      console.warn(
        `[Security] Access denied to file outside media directories: (resolved from ${filePath})`,
      );
      result = {
        isAllowed: false,
        message: 'Access denied',
      };
    }
  }

  // Bolt Optimization: Cache result
  if (!mediaDirectories) {
    cacheAuthResult(filePath, result);
  }

  return result;
}

/**
 * Basic sanity checks for file paths.
 */
export function validateInput(filePath: string): AuthorizationResult | null {
  if (
    !filePath ||
    filePath.includes('\0') ||
    filePath.includes('\r') ||
    filePath.includes('\n')
  ) {
    return { isAllowed: false, message: 'Invalid file path' };
  }

  if (filePath.length > MAX_PATH_LENGTH) {
    console.warn(
      `[Security] Rejected overly long file path (${filePath.length} chars)`,
    );
    return { isAllowed: false, message: 'Invalid file path (too long)' };
  }

  return null;
}

/**
 * Handles validation for virtual/drive paths (e.g., gdrive://).
 */
async function authorizeVirtualPath(
  filePath: string,
): Promise<AuthorizationResult | null> {
  const trimmed = filePath.trim();
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(trimmed);

  if (!schemeMatch || trimmed.includes('..') || trimmed.includes('\\')) {
    return null;
  }

  // Strict validation: Verify the file is actually in our scanned library.
  // This prevents IDOR attacks where an attacker accesses a file ID that exists in Drive
  // but is not part of the allowed/scanned folders.
  if (
    typeof isFileInLibrary === 'function' &&
    (await isFileInLibrary(trimmed))
  ) {
    return { isAllowed: true, realPath: trimmed };
  }

  return null;
}

/**
 * Handles validation for local filesystem paths.
 */
async function authorizeLocalPath(
  filePath: string,
  allowedPaths: string[],
): Promise<AuthorizationResult | null> {
  // Normalize separators and collapse any "." / ".." segments for consistent handling.
  const safePath = path.normalize(filePath);
  const isAbsolute = path.isAbsolute(safePath);

  if (!isAbsolute) {
    // After normalization, reject any path that still attempts to traverse upwards.
    if (
      safePath === '..' ||
      safePath.startsWith('..' + path.sep) ||
      safePath.includes('/..') ||
      safePath.includes('\\..')
    ) {
      return {
        isAllowed: false,
        message: 'Access denied',
      };
    }

    // On Windows, also defensively reject drive-like prefixes in a "relative" path.
    if (
      process.platform === 'win32' &&
      /^[a-zA-Z]:[\\/]|^\\\\/.test(safePath)
    ) {
      return {
        isAllowed: false,
        message: 'Access denied',
      };
    }
  }

  for (const allowedDir of allowedPaths) {
    if (!allowedDir || !String(allowedDir).trim() || isDrivePath(allowedDir)) {
      continue;
    }

    const result = await validatePathAgainstDir(allowedDir, safePath);
    if (result) {
      return result;
    }
  }
  return null;
}

/**
 * Tries to resolve and validate a path against a specific allowed directory.
 */
export async function validatePathAgainstDir(
  allowedDir: string,
  safePath: string,
): Promise<AuthorizationResult | null> {
  try {
    const allowedRootReal = await fs.realpath(path.resolve(allowedDir));

    // Guard the relative path before anchoring to the trusted root.
    // path.resolve(trustedRoot, relPath) is the pattern CodeQL
    // js/path-injection recognises as a sanitiser barrier.
    const relPath = path.relative(
      allowedRootReal,
      path.resolve(allowedRootReal, safePath),
    );
    if (
      relPath === '..' ||
      relPath.startsWith('..' + path.sep) ||
      path.isAbsolute(relPath)
    ) {
      return null;
    }
    const candidateRealPath = await fs.realpath(
      path.resolve(allowedRootReal, relPath),
    );

    // Post-symlink containment check — catches symlinks pointing outside root.
    const rootPrefix = allowedRootReal.endsWith(path.sep)
      ? allowedRootReal
      : allowedRootReal + path.sep;
    if (
      candidateRealPath !== allowedRootReal &&
      !candidateRealPath.startsWith(rootPrefix)
    ) {
      return null;
    }

    // candidateRealPath is within allowedRootReal — compute the relative
    // segment for the sensitive-filename sub-check only.
    const relative = path.relative(allowedRootReal, candidateRealPath);
    if (hasSensitiveSegments(relative)) {
      console.warn(
        `[Security] Access denied to sensitive file: ${candidateRealPath}`,
      );
      return {
        isAllowed: false,
        message: 'Access to sensitive file denied',
      };
    }
    return { isAllowed: true, realPath: candidateRealPath };
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      console.warn(
        `[Security] File check failed for ${safePath}: ${(error as Error).message}`,
      );
    }
  }
  return null;
}

/**
 * Checks if a relative path contains sensitive segments.
 */
function hasSensitiveSegments(relativePath: string): boolean {
  const segments = relativePath.split(path.sep);
  return segments.some(isHiddenOrSensitive);
}

/**
 * Checks if a path segment is hidden (starts with .) or sensitive.
 */
function isHiddenOrSensitive(segment: string): boolean {
  return segment.startsWith('.') || isSensitiveFilename(segment);
}

/**
 * Escapes HTML characters in a string to prevent XSS.
 * @param str - The string to escape.
 * @returns The escaped string.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Helper to get Windows restricted paths from environment or defaults.
 */
function getWindowsRestrictedPaths(): string[] {
  const drive = process.env.SystemDrive || 'C:';
  return WINDOWS_RESTRICTED_ROOT_PATHS.map((r) => {
    switch (r) {
      case 'Windows':
        return process.env.SystemRoot || `${drive}\\Windows`;
      case 'Program Files':
        return process.env.ProgramFiles || `${drive}\\Program Files`;
      case 'Program Files (x86)':
        return (
          process.env['ProgramFiles(x86)'] || `${drive}\\Program Files (x86)`
        );
      case 'ProgramData':
        return process.env.ProgramData || `${drive}\\ProgramData`;
      default:
        // This case should not be reached with current constants.
        // Adding a warning helps catch future configuration errors.
        console.warn(`[Security] Unhandled restricted path component: ${r}`);
        return `${drive}\\${r}`;
    }
  });
}

// Common Linux/Unix sensitive directories
const LINUX_RESTRICTED_PATHS = [
  '/etc',
  '/proc',
  '/sys',
  '/root',
  '/boot',
  '/dev',
  '/bin',
  '/sbin',
  '/usr',
  '/lib',
  '/lib64',
  '/opt',
  '/srv',
  '/tmp',
  '/run',
  '/var',
];

/**
 * Attempts to resolve the real path, handling symlinks and errors.
 */
function resolvePath(
  dirPath: string,
  p: typeof path.win32 | typeof path.posix,
): string {
  try {
    // Attempt to resolve real path to handle symlinks (security bypass)
    // We only call realpathSync if the targeted platform matches the actual host platform
    // to avoid host-specific resolution (e.g. '/' -> 'C:\') during tests.
    const isHostWindows = path.sep === '\\';
    const targetIsWindows = process.platform === 'win32';

    if (targetIsWindows === isHostWindows) {
      return realpathSync(p.resolve(dirPath));
    }
  } catch {
    // Fallback if file doesn't exist, permission denied, etc.
  }
  // Platform mismatch (likely a test) or error, fall back to logical resolution
  return p.resolve(dirPath);
}

/**
 * Checks if the normalized path is within any restricted root.
 */
function checkRestrictedRoots(
  normalized: string,
  restrictedRoots: string[],
): boolean {
  if (process.platform === 'win32') {
    // Windows: Case-insensitive check
    const normalizedLower = normalized.toLowerCase();

    // Block UNC paths to prevent bypass of drive-letter based restrictions
    if (normalizedLower.startsWith('\\\\')) return true;

    return restrictedRoots.some(
      (r) =>
        normalizedLower === r.toLowerCase() ||
        normalizedLower.startsWith(r.toLowerCase() + '\\'),
    );
  } else {
    // Linux: Strict check
    return restrictedRoots.some(
      (r) => normalized === r || normalized.startsWith(r + '/'),
    );
  }
}

/**
 * Helper to check path restrictions against a list of restricted roots.
 * Handles platform-specific logic and sensitive segment checks.
 */
function checkPathRestrictions(
  dirPath: string,
  restrictedRoots: string[],
): boolean {
  if (!dirPath) return true;

  // Select path module based on platform (supports mocking in tests)
  const p = process.platform === 'win32' ? path.win32 : path.posix;

  const normalized = resolvePath(dirPath, p);
  const segments = normalized.split(p.sep);

  // Check if any segment is a sensitive directory (e.g. .ssh)
  if (segments.some(isHiddenOrSensitive)) {
    return true;
  }

  return checkRestrictedRoots(normalized, restrictedRoots);
}

/**
 * Checks if a path is restricted for listing contents.
 * Allows root listing for navigation, but blocks internal system folders.
 * @param dirPath - The path to check.
 * @returns True if the path is restricted.
 */
export function isRestrictedPath(dirPath: string): boolean {
  const restricted =
    process.platform === 'win32'
      ? getWindowsRestrictedPaths()
      : LINUX_RESTRICTED_PATHS;

  return checkPathRestrictions(dirPath, restricted);
}

/**
 * Checks if a path is a sensitive system root that should not be scanned recursively.
 * Used when adding media directories.
 * @param dirPath - The path to check.
 * @returns True if the path is sensitive.
 */
export function isSensitiveDirectory(dirPath: string): boolean {
  const restricted =
    process.platform === 'win32'
      ? [`${process.env.SystemDrive || 'C:'}\\`, ...getWindowsRestrictedPaths()]
      : ['/', ...LINUX_RESTRICTED_PATHS];

  return checkPathRestrictions(dirPath, restricted);
}

/**
 * Checks if a filename is sensitive (should be hidden/blocked).
 * @param filename - The name of the file.
 * @returns True if the filename is sensitive.
 */
export function isSensitiveFilename(filename: string): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();

  if (sensitiveSubdirectoriesSet.has(lower)) {
    return true;
  }

  // [SECURITY] Block sensitive file variations (e.g. backups, old versions)

  // 1. SSH Private Keys (block variations unless public key)
  if (
    SSH_KEY_PREFIXES.some((k) => lower.startsWith(k)) &&
    !lower.endsWith('.pub')
  ) {
    return true;
  }

  // 2. Generic Sensitive Prefixes (block all variations)
  // This covers configs, credentials, history files, etc.
  if (SENSITIVE_FILE_PREFIXES.some((p) => lower.startsWith(p))) {
    return true;
  }

  return false;
}

/**
 * Checks if a directory should be ignored during scanning or listing.
 * Includes hidden directories (starting with .) and sensitive directories.
 * @param name - The name of the directory (not the full path).
 * @returns True if the directory should be ignored.
 */
export function isIgnoredDirectory(name: string): boolean {
  if (!name) return true;
  return name.startsWith('.') || isSensitiveFilename(name);
}
