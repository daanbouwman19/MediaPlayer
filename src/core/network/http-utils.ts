import type { ServerResponse } from 'http';
import type { Readable } from 'stream';
import rangeParser from 'range-parser';

export interface HttpRange {
  /** First byte to send. */
  start: number;
  /** Last byte to send (inclusive). */
  end: number;
  /**
   * True when a satisfiable `bytes` range was applied, so the reply is a 206
   * with Content-Range. False means the whole representation is sent (200).
   */
  partial: boolean;
  /** True when the range is unsatisfiable (416). */
  error?: boolean;
}

/**
 * Parses the HTTP Range header to determine start and end bytes.
 *
 * Following RFC 9110, a missing or malformed header, or a range unit other
 * than `bytes`, is ignored and the full content is selected (`partial` is
 * false). Only the first range of a multi-range request is honoured.
 *
 * @param totalSize - The total size of the file in bytes.
 * @param rangeHeader - The 'Range' header string from the request.
 */
export function parseHttpRange(
  totalSize: number,
  rangeHeader?: string,
): HttpRange {
  const full: HttpRange = { start: 0, end: totalSize - 1, partial: false };
  if (!rangeHeader) {
    return full;
  }

  const unitEnd = rangeHeader.indexOf('=');
  if (
    unitEnd === -1 ||
    rangeHeader.slice(0, unitEnd).trim().toLowerCase() !== 'bytes'
  ) {
    return full;
  }

  const ranges = rangeParser(totalSize, rangeHeader);

  // Unsatisfiable range (e.g. requesting bytes past the end of the file).
  if (ranges === -1) {
    return { start: 0, end: 0, partial: false, error: true };
  }

  // Malformed range set: ignore the header.
  const first = ranges === -2 ? undefined : ranges[0];
  if (!first) {
    return full;
  }

  return { start: first.start, end: first.end, partial: true };
}

/** Headers that describe a body which is no longer going to be sent. */
const BODY_HEADERS = [
  'Content-Length',
  'Content-Range',
  'Content-Type',
  'Accept-Ranges',
];

/**
 * Streams `source` into an HTTP response and ties their lifetimes together.
 *
 * - When the response closes (finished or aborted by the client) the source
 *   is destroyed, which releases its file descriptor, Drive socket or pipe.
 * - A source error before the first byte becomes a plain 500 without the
 *   Content-Length/Content-Range that were set for the body.
 * - A source error after the headers went out destroys the response, so the
 *   client sees a failed transfer instead of waiting for bytes that never
 *   come.
 *
 * This is stream.pipeline() semantics, except that pipeline() would destroy
 * the response on an early error and lose the chance to reply with a 500.
 * Callers must check `res.destroyed` themselves after their last await; it is
 * checked again here so an already-closed response never leaks the source.
 */
export function pipeToResponse(
  source: Readable,
  res: ServerResponse,
  label: string,
): void {
  if (res.destroyed) {
    source.destroy();
    return;
  }

  res.once('close', () => {
    source.destroy();
  });

  source.once('error', (err: Error) => {
    console.error(`[${label}] Stream error:`, err);
    source.unpipe(res);
    source.destroy();
    if (!res.headersSent) {
      for (const header of BODY_HEADERS) res.removeHeader(header);
      res.statusCode = 500;
      res.end();
    } else {
      res.destroy(err);
    }
  });

  source.pipe(res);
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
