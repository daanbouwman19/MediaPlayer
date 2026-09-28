/**
 * @file Cheap version tag for a media file, used to key derived-data caches.
 */
import fs from 'fs/promises';
import { isDrivePath } from './media-utils.ts';
import { getProvider } from '../../infrastructure/fs-provider-factory.ts';

/**
 * Returns a string that changes whenever the file is edited or replaced
 * (size + modification time), or null if the file cannot be inspected.
 * Derived data (thumbnails, heatmaps) keyed by path plus this identity is
 * regenerated for a new version of the file instead of being served stale.
 */
export async function getFileIdentity(
  filePath: string,
): Promise<string | null> {
  try {
    if (isDrivePath(filePath)) {
      const meta = await getProvider(filePath).getMetadata(filePath);
      const modified = meta.lastModified ? meta.lastModified.getTime() : 0;
      return `${meta.size}-${modified}`;
    }
    const stats = await fs.stat(filePath);
    return `${stats.size}-${Math.floor(stats.mtimeMs)}`;
  } catch {
    return null;
  }
}
