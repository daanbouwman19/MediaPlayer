import fs from 'fs';
import { Readable } from 'stream';
import { getDriveCacheManager } from '../../main/drive-cache-manager.ts';
import {
  getDriveFileStream,
  getDriveFileMetadata,
} from '../../main/google-drive-service.ts';

/**
 * Retrieves a stream for a Drive file, utilizing local cache if available.
 */
export async function getDriveStreamWithCache(
  fileId: string,
  range?: { start?: number; end?: number },
): Promise<{ stream: Readable; length: number }> {
  const cacheManager = getDriveCacheManager();

  try {
    const { path: cachedPath, totalSize } =
      await cacheManager.getCachedFilePath(fileId);

    const stats = await fs.promises.stat(cachedPath).catch(() => ({ size: 0 }));
    const cachedSize = stats.size;

    const start = range?.start ?? 0;
    const end = range?.end ?? totalSize - 1;

    // Hybrid Caching Logic
    if (start < cachedSize) {
      const safeEnd = Math.min(end, cachedSize - 1);
      const length = safeEnd - start + 1;
      const stream = fs.createReadStream(cachedPath, { start, end: safeEnd });

      return { stream, length };
    } else {
      const stream = await getDriveFileStream(fileId, { start, end });
      const length = end - start + 1;

      return { stream, length };
    }
  } catch (e) {
    console.warn('Drive Cache/Fetch failed', e);
    // Fallback
    const meta = await getDriveFileMetadata(fileId);
    const totalSize = Number(meta.size);
    const start = range?.start ?? 0;
    const end = range?.end ?? totalSize - 1;
    const length = end - start + 1;

    const stream = await getDriveFileStream(fileId, range);
    return { stream, length };
  }
}
