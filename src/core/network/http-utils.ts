import rangeParser from 'range-parser';

/**
 * Parses the HTTP Range header to determine start and end bytes.
 * Handles parsing errors by falling back to the full file range.
 *
 * @param totalSize - The total size of the file in bytes.
 * @param rangeHeader - The 'Range' header string from the request.
 * @returns An object containing `start` and `end` offsets, or an `error` flag if unsatisfiable.
 */
export function parseHttpRange(
  totalSize: number,
  rangeHeader?: string,
): { start: number; end: number; error?: boolean } {
  // Default to full content
  if (!rangeHeader) {
    return { start: 0, end: totalSize - 1 };
  }

  const ranges = rangeParser(totalSize, rangeHeader);

  // Case: Unsatisfiable range (e.g. requesting bytes past end of file)
  if (ranges === -1) {
    return { start: 0, end: 0, error: true };
  }

  // Case: Malformed header or other error -> treat as full content (ignore header)
  // ranges === -2 is malformed
  if (ranges === -2 || !Array.isArray(ranges) || ranges.length === 0) {
    return { start: 0, end: totalSize - 1 };
  }

  // Success: Return the first range
  return { start: ranges[0].start, end: ranges[0].end };
}

/**
 * Extracts a query parameter from a query object, handling array/string cases.
 * Returns the first value if it's an array.
 *
 * @param query - The query object (e.g. req.query).
 * @param key - The query parameter key.
 * @returns The value as a string, or undefined if missing.
 */
export function getQueryParam(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = query[key];
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}
