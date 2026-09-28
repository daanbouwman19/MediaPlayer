/**
 * @file Cheap version tag for a media file, used to key derived-data caches.
 */
import fs from 'fs/promises';
import { getDriveId, isDrivePath } from './media-utils.ts';
import {
  getDriveFileMetadataCached,
  type DriveFileMetadata,
} from './drive-backend.ts';

/**
 * Builds the version tag of a Drive file. The revision fields change with
 * every new upload under the same file ID, even when the byte size stays the
 * same, so they are preferred. createdTime never changes for a file ID and is
 * only used, together with the size, when Drive reports no revision field.
 */
function getDriveIdentity(meta: DriveFileMetadata): string {
  const size = Number(meta.size || 0);
  const revision = meta.headRevisionId || meta.md5Checksum || meta.modifiedTime;
  if (revision) return `${revision}-${size}`;
  const created = meta.createdTime ? new Date(meta.createdTime).getTime() : 0;
  return `${size}-${Number.isFinite(created) ? created : 0}`;
}

/**
 * Returns a string that changes whenever the file is edited or replaced
 * (size + modification time, or the Drive revision), or null if the file
 * cannot be inspected. Derived data (thumbnails, heatmaps) keyed by path plus
 * this identity is regenerated for a new version of the file instead of being
 * served stale.
 */
export async function getFileIdentity(
  filePath: string,
): Promise<string | null> {
  try {
    if (isDrivePath(filePath)) {
      const meta = await getDriveFileMetadataCached(getDriveId(filePath));
      return getDriveIdentity(meta);
    }
    const stats = await fs.stat(filePath);
    return `${stats.size}-${Math.floor(stats.mtimeMs)}`;
  } catch {
    return null;
  }
}
