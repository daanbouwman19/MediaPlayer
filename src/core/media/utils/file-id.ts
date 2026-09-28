import fs from 'fs/promises';
import crypto from 'crypto';
import { isDrivePath, getDriveId } from '../media-utils.ts';

/**
 * Returns the file path currently stored for a file ID, or null/undefined
 * when no row uses that ID (or the row has no path).
 */
export type FileIdOwnerLookup = (fileId: string) => string | null | undefined;

/** Number of files stat'ed concurrently by {@link assignFileIds}. */
const ID_IO_BATCH_SIZE = 50;

function md5(value: string): string {
  return crypto.createHash('md5').update(value).digest('hex');
}

/**
 * Generates a stable, content-based identifier for a file.
 * Local files hash their size and mtime, so a moved or renamed file keeps
 * its identity. Copies that preserve the mtime share this ID; use
 * {@link assignFileIds} or {@link generateUniqueFileId} to allocate IDs that
 * are unique in the database.
 * @param filePath - The path to the file.
 * @returns A unique MD5 hash for the file.
 */
export async function generateFileId(filePath: string): Promise<string> {
  if (!filePath) {
    throw new Error('File path cannot be null or empty');
  }
  try {
    if (isDrivePath(filePath)) {
      return getDriveId(filePath);
    }
    const stats = await fs.stat(filePath);
    const uniqueString = `${stats.size}-${stats.mtime.getTime()}`;
    return md5(uniqueString);
  } catch (error: unknown) {
    // If we can't stat the file (e.g. invalid path), fallback to hashing the path string
    if ((error as { code?: string }).code !== 'ENOENT') {
      console.error(
        `[file-id] Error generating file ID for ${filePath}:`,
        error,
      );
    }
    return md5(filePath);
  }
}

/**
 * The ID given to a file whose content-based ID already belongs to another
 * path that still exists (for example a copy with the same size and mtime,
 * or a hard link). It is derived from the path, so it is stable for that
 * path.
 */
export function pathScopedFileId(baseId: string, filePath: string): string {
  return md5(`${baseId}\0${filePath}`);
}

/**
 * Whether nothing exists at `ownerPath` any more. Only a definite "not
 * there" counts: any other error (e.g. EACCES, or an unmounted share
 * reporting EIO) keeps the owner's claim, so its stats are never stolen.
 */
async function isOwnerGone(ownerPath: string): Promise<boolean> {
  try {
    await fs.stat(ownerPath);
    return false;
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    return code === 'ENOENT' || code === 'ENOTDIR';
  }
}

/**
 * Picks the database ID for `filePath` given its content-based `baseId` and
 * the path currently stored under that ID.
 *
 * The content-based ID is kept whenever it is free, so existing rows keep
 * their IDs. A row is re-pointed to a new path only when its old path no
 * longer exists (the file was moved or renamed). While the old path still
 * exists, the new path gets its own {@link pathScopedFileId} instead of
 * taking over that path's ratings, views and playback position. This holds
 * for hard links and other spellings of the same file too: rows are keyed
 * by path, and one row shared by two paths that are both scanned would be
 * re-pointed to whichever path was written last, on every scan.
 */
export async function resolveFileIdCollision(
  filePath: string,
  baseId: string,
  ownerPath: string | null | undefined,
): Promise<string> {
  if (!ownerPath || ownerPath === filePath || isDrivePath(filePath)) {
    return baseId;
  }
  return (await isOwnerGone(ownerPath))
    ? baseId
    : pathScopedFileId(baseId, filePath);
}

/**
 * Generates a database-unique ID for a single file (see
 * {@link resolveFileIdCollision}).
 * @param filePath - The path to the file.
 * @param getOwnerPath - Looks up the path stored for an existing ID.
 */
export async function generateUniqueFileId(
  filePath: string,
  getOwnerPath: FileIdOwnerLookup,
): Promise<string> {
  const baseId = await generateFileId(filePath);
  return resolveFileIdCollision(filePath, baseId, getOwnerPath(baseId));
}

/**
 * Generates database-unique IDs for files that have no row yet. IDs handed
 * out earlier in the same call count as taken, so two copies indexed in one
 * batch also get distinct IDs.
 * @param filePaths - Paths without an existing row.
 * @param getOwnerPath - Looks up the path stored for an existing ID.
 * @returns Map of file path to ID. Paths whose ID can't be generated are
 * left out.
 */
export async function assignFileIds(
  filePaths: string[],
  getOwnerPath: FileIdOwnerLookup,
): Promise<Map<string, string>> {
  const assigned = new Map<string, string>();
  const claimedBy = new Map<string, string>();

  for (let i = 0; i < filePaths.length; i += ID_IO_BATCH_SIZE) {
    const batch = filePaths.slice(i, i + ID_IO_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(generateFileId));

    // Resolve collisions sequentially so claims made in this call are seen.
    for (let j = 0; j < batch.length; j++) {
      const filePath = batch[j];
      const result = results[j];
      if (filePath === undefined || result?.status !== 'fulfilled') continue;

      const baseId = result.value;
      const ownerPath = claimedBy.get(baseId) ?? getOwnerPath(baseId);
      const fileId =
        ownerPath && ownerPath !== filePath
          ? await resolveFileIdCollision(filePath, baseId, ownerPath)
          : baseId;
      assigned.set(filePath, fileId);
      claimedBy.set(fileId, filePath);
    }
  }
  return assigned;
}
