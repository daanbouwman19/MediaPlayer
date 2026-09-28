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

/** Wait after the first failed extraction before a scan retries it. */
export const EXTRACTION_RETRY_BASE_MS = 60 * 60 * 1000;
/** Longest wait between automatic retries of a failing extraction. */
export const EXTRACTION_RETRY_MAX_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long scans wait before retrying an extraction that has failed
 * `attempts` times in a row: one hour, doubling per failure, capped at a
 * week. Retries never stop, so a Drive video that is processed later, or a
 * file that finished copying, is still picked up.
 */
export function extractionRetryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(attempts - 1, 30));
  return Math.min(
    EXTRACTION_RETRY_BASE_MS * 2 ** exponent,
    EXTRACTION_RETRY_MAX_MS,
  );
}

/**
 * Whether a failed extraction is still in its backoff window, so a scan
 * should not probe the file again yet. Rows without an attempt time (failed
 * before attempts were recorded) are retried once to start the count.
 * @param status - The stored extraction status.
 * @param attempts - Consecutive failed attempts. SQL NULL arrives as null.
 * @param attemptedAt - Last attempt time in epoch ms, or null.
 * @param now - The current time in epoch ms.
 */
export function isExtractionBackedOff(
  status: unknown,
  attempts: unknown,
  attemptedAt: unknown,
  now: number,
): boolean {
  if (status !== 'failed') return false;
  if (typeof attemptedAt !== 'number' || !Number.isFinite(attemptedAt))
    return false;
  const count =
    typeof attempts === 'number' && Number.isFinite(attempts) ? attempts : 0;
  if (count < 1) return false;
  return now - attemptedAt < extractionRetryDelayMs(count);
}
