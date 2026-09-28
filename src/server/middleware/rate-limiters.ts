/**
 * @file Rate limiter factories for server routes.
 */
import {
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_FILE_MAX_REQUESTS,
  RATE_LIMIT_FILE_WINDOW_MS,
  RATE_LIMIT_READ_MAX_REQUESTS,
  RATE_LIMIT_READ_WINDOW_MS,
  RATE_LIMIT_TELEMETRY_MAX_REQUESTS,
  RATE_LIMIT_TELEMETRY_WINDOW_MS,
  RATE_LIMIT_WRITE_MAX_REQUESTS,
  RATE_LIMIT_WRITE_WINDOW_MS,
} from '../../core/media/constants.ts';
import { createRateLimiter } from '../../core/network/rate-limiter.ts';

// Basic Auth failures are counted inside basicAuthMiddleware itself, so that
// only rejected credentials (not 4xx/5xx responses or aborted range requests
// of authenticated users) count towards the lockout.
export interface RateLimiters {
  authLimiter: ReturnType<typeof createRateLimiter>;
  writeLimiter: ReturnType<typeof createRateLimiter>;
  telemetryLimiter: ReturnType<typeof createRateLimiter>;
  readLimiter: ReturnType<typeof createRateLimiter>;
  fileLimiter: ReturnType<typeof createRateLimiter>;
  streamLimiter: ReturnType<typeof createRateLimiter>;
}

export function createRateLimiters(): RateLimiters {
  const authLimiter = createRateLimiter(
    RATE_LIMIT_AUTH_WINDOW_MS,
    RATE_LIMIT_AUTH_MAX_REQUESTS,
    'Too many auth attempts. Please try again later.',
  );

  // Strict budget for library-changing writes (scan, sources, playlists,
  // ratings). Each limiter has its own store, so telemetry cannot use it up.
  const writeLimiter = createRateLimiter(
    RATE_LIMIT_WRITE_WINDOW_MS,
    RATE_LIMIT_WRITE_MAX_REQUESTS,
    'Too many requests. Please slow down.',
  );

  // View counts and playback position, sent on every slide and every few
  // seconds of playback.
  const telemetryLimiter = createRateLimiter(
    RATE_LIMIT_TELEMETRY_WINDOW_MS,
    RATE_LIMIT_TELEMETRY_MAX_REQUESTS,
    'Too many requests. Please slow down.',
  );

  const readLimiter = createRateLimiter(
    RATE_LIMIT_READ_WINDOW_MS,
    RATE_LIMIT_READ_MAX_REQUESTS,
    'Too many requests. Please slow down.',
  );

  const fileLimiter = createRateLimiter(
    RATE_LIMIT_FILE_WINDOW_MS,
    RATE_LIMIT_FILE_MAX_REQUESTS,
    'Too many requests. Please slow down.',
  );

  const streamLimiter = createRateLimiter(
    RATE_LIMIT_FILE_WINDOW_MS,
    RATE_LIMIT_FILE_MAX_REQUESTS,
    'Too many stream requests. Please slow down.',
  );

  return {
    authLimiter,
    writeLimiter,
    telemetryLimiter,
    readLimiter,
    fileLimiter,
    streamLimiter,
  };
}
