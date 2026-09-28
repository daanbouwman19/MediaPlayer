/**
 * @file Validation for client-supplied media metadata (web routes and IPC).
 *
 * Clients may only set the fields of {@link MediaMetadata}. Anything else is
 * dropped, so a request can never choose which row it writes (`filePath`) or
 * whether a file counts as a library member; both are decided server-side.
 */
import { AppError } from '../media/errors.ts';
import type { MediaMetadata } from '../media/types.ts';

/** Upper bound on the number of watched segments stored for one file. */
export const MAX_WATCHED_SEGMENTS = 5000;

/** Upper bound on the length of a watched-segments JSON payload. */
export const MAX_WATCHED_SEGMENTS_JSON_LENGTH = 512 * 1024;

/** Ratings are whole stars, 0 (unrated) to 5. */
const MAX_RATING = 5;

/** Generous bound for an ISO 8601 timestamp. */
const MAX_TIMESTAMP_LENGTH = 64;

/** Metadata extraction states (see media-service.ts). */
const EXTRACTION_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'processing',
  'success',
  'failed',
]);

function invalidField(field: string): AppError {
  return new AppError(400, `Invalid metadata field: ${field}`);
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** True for values a JSON client uses to leave a field unset. */
function isUnset(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

/**
 * Validates a watched-segments payload ({start, end}[] as JSON) and returns
 * it re-serialised with only the segments that can be stored. Entries the
 * player could not measure (NaN serialises to null) are skipped, as the
 * worker always did; structural problems and oversized payloads are
 * rejected with a 400 {@link AppError}.
 */
export function normalizeWatchedSegments(input: unknown): string {
  if (typeof input !== 'string') {
    throw new AppError(400, 'Watched segments must be a JSON string');
  }
  if (input.length > MAX_WATCHED_SEGMENTS_JSON_LENGTH) {
    throw new AppError(400, 'Watched segments payload is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new AppError(400, 'Watched segments must be valid JSON');
  }
  if (!Array.isArray(parsed)) {
    throw new AppError(400, 'Watched segments must be a JSON array');
  }
  if (parsed.length > MAX_WATCHED_SEGMENTS) {
    throw new AppError(
      400,
      `Too many watched segments (at most ${MAX_WATCHED_SEGMENTS})`,
    );
  }

  const segments: { start: number; end: number }[] = [];
  for (const entry of parsed as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { start, end } = entry as { start?: unknown; end?: unknown };
    if (!isNonNegativeFinite(start) || !isNonNegativeFinite(end)) continue;
    if (end < start) continue;
    segments.push({ start, end });
  }
  return JSON.stringify(segments);
}

/**
 * Validates client-supplied metadata and returns a copy holding only the
 * known {@link MediaMetadata} fields. Unknown keys (including `filePath`) are
 * dropped; a known field with the wrong type or range is rejected with a
 * 400 {@link AppError}. `null` is treated like a missing field.
 */
export function parseMetadataUpdate(input: unknown): MediaMetadata {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new AppError(400, 'Metadata must be an object');
  }
  const {
    duration,
    size,
    rating,
    createdAt,
    status,
    watchedSegments,
    playbackPosition,
  } = input as Record<string, unknown>;
  const result: MediaMetadata = {};

  if (!isUnset(duration)) {
    if (!isNonNegativeFinite(duration)) throw invalidField('duration');
    result.duration = duration;
  }
  if (!isUnset(size)) {
    if (!isNonNegativeFinite(size) || !Number.isInteger(size)) {
      throw invalidField('size');
    }
    result.size = size;
  }
  if (!isUnset(rating)) {
    if (
      typeof rating !== 'number' ||
      !Number.isInteger(rating) ||
      rating < 0 ||
      rating > MAX_RATING
    ) {
      throw invalidField('rating');
    }
    result.rating = rating;
  }
  if (!isUnset(createdAt)) {
    if (
      typeof createdAt !== 'string' ||
      createdAt.length > MAX_TIMESTAMP_LENGTH ||
      Number.isNaN(Date.parse(createdAt))
    ) {
      throw invalidField('createdAt');
    }
    result.createdAt = createdAt;
  }
  if (!isUnset(status)) {
    if (typeof status !== 'string' || !EXTRACTION_STATUSES.has(status)) {
      throw invalidField('status');
    }
    result.status = status;
  }
  if (!isUnset(watchedSegments)) {
    result.watchedSegments = normalizeWatchedSegments(watchedSegments);
  }
  if (!isUnset(playbackPosition)) {
    if (!isNonNegativeFinite(playbackPosition)) {
      throw invalidField('playbackPosition');
    }
    result.playbackPosition = playbackPosition;
  }
  return result;
}
