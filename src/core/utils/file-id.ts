import fs from 'fs/promises';
import crypto from 'crypto';
import { isDrivePath, getDriveId } from '../media-utils.ts';

/**
 * Generates a stable, unique identifier for a file.
 * @param filePath - The path to the file.
 * @returns A unique MD5 hash for the file.
 */
export async function generateFileId(filePath: string): Promise<string> {
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
        `[file-id] Error generating file ID for ${filePath}:`,
        error,
      );
    }
    return crypto.createHash('md5').update(filePath).digest('hex');
  }
}
