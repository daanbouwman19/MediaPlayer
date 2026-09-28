import path from 'path';
import crypto from 'crypto';

import { GDRIVE_PROTOCOL } from './constants.ts';

/**
 * Checks if the given path is a Google Drive path.
 * @param filePath The file path to check.
 */
export function isDrivePath(filePath: string): boolean {
  return filePath.startsWith(GDRIVE_PROTOCOL);
}

/**
 * Extracts the Google Drive file ID from a gdrive:// path.
 * @param filePath The gdrive:// path.
 */
export function getDriveId(filePath: string): string {
  if (!isDrivePath(filePath)) return filePath;
  return filePath.slice(GDRIVE_PROTOCOL.length);
}

/**
 * Creates a gdrive:// path from a file ID.
 * @param fileId The Google Drive file ID.
 */
export function createDrivePath(fileId: string): string {
  return `${GDRIVE_PROTOCOL}${fileId}`;
}

/**
 * Returns the thumbnail cache file for a media file.
 * @param identity The file's version tag (see getFileIdentity). Including it
 * gives an edited or replaced file a fresh thumbnail; without one the legacy
 * path-only key is used.
 */
export function getThumbnailCachePath(
  filePath: string,
  cacheDir: string,
  identity?: string | null,
) {
  const key = identity ? `${filePath}\0${identity}` : filePath;
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return path.join(cacheDir, `${hash}.jpg`);
}

/**
 * Normalizes a file path, handling platform-specific quirks (e.g., Windows drive letters in URLs).
 * @param filePath The raw file path from the request.
 * @param platform The platform to normalize for (defaults to process.platform).
 */
export function normalizeFilePath(
  filePath: string,
  platform: string = process.platform,
): string {
  let normalized = decodeURIComponent(filePath);
  // On Windows, pathname start with a slash like /C:/Users... Express req.path preserves it.
  if (platform === 'win32' && normalized.startsWith('/')) {
    normalized = normalized.substring(1);
  }
  // Drive paths encoded as URL paths arrive with a leading slash (/gdrive://...)
  // Strip it to recover the canonical gdrive:// scheme.
  if (normalized.startsWith('/') && isDrivePath(normalized.substring(1))) {
    normalized = normalized.substring(1);
  }
  return normalized;
}
