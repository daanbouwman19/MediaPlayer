/**
 * @file Helpers for the per-file "watched segments" overlay: the time ranges
 * the user has actually played, stored as a JSON string in the database.
 */

export interface WatchedSegment {
  start: number;
  end: number;
}

/** Segments closer than this (seconds) are merged into one. */
const MERGE_GAP_S = 0.5;

const isWatchedSegment = (value: unknown): value is WatchedSegment => {
  if (typeof value !== 'object' || value === null) return false;
  const { start, end } = value as Record<string, unknown>;
  return (
    typeof start === 'number' &&
    typeof end === 'number' &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start >= 0 &&
    end >= start
  );
};

/**
 * Parses the stored watched-segments JSON. Missing, malformed or partially
 * invalid data never throws: invalid entries are dropped and anything that
 * is not an array yields an empty list.
 */
export function parseWatchedSegments(json: unknown): WatchedSegment[] {
  if (typeof json !== 'string' || json === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const segments: WatchedSegment[] = [];
  for (const entry of parsed) {
    if (isWatchedSegment(entry)) {
      segments.push({ start: entry.start, end: entry.end });
    }
  }
  return segments;
}

/**
 * Returns a new, sorted list with `segment` merged into `segments`.
 * Overlapping or nearly adjacent ranges are coalesced. The input list is
 * not mutated.
 */
export function addWatchedSegment(
  segments: readonly WatchedSegment[],
  segment: WatchedSegment,
): WatchedSegment[] {
  const sorted: WatchedSegment[] = [];
  for (const existing of segments) {
    sorted.push({ start: existing.start, end: existing.end });
  }
  sorted.push({ start: segment.start, end: segment.end });
  sorted.sort((a, b) => a.start - b.start);

  const merged: WatchedSegment[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end + MERGE_GAP_S) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}
