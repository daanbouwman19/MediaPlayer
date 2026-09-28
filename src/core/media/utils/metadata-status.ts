/**
 * @file Decides whether stored media metadata still needs extraction.
 */
import path from 'path';
import { SUPPORTED_VIDEO_EXTENSIONS_SET } from '../constants.ts';

/**
 * Whether stored metadata needs no further extraction: the row is
 * 'success' and, for a video, holds a real duration.
 *
 * Versions that stored failed duration probes as 'success' left videos
 * with a NULL duration that were never retried. Treating those rows as
 * incomplete sends them back through extraction until a duration is read.
 * @param filePath - The file's path; its extension tells whether it is a
 *   video. Drive paths carry no extension and only need a 'success' status.
 * @param status - The stored extraction status.
 * @param duration - The stored duration. SQL NULL arrives as null.
 */
export function isMetadataComplete(
  filePath: string,
  status: unknown,
  duration: unknown,
): boolean {
  if (status !== 'success') return false;
  if (!SUPPORTED_VIDEO_EXTENSIONS_SET.has(path.extname(filePath).toLowerCase()))
    return true;
  return (
    typeof duration === 'number' && Number.isFinite(duration) && duration > 0
  );
}
