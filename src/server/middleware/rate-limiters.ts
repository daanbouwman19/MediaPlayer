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
  RATE_LIMIT_WRITE_MAX_REQUESTS,
  RATE_LIMIT_WRITE_WINDOW_MS,
} from '../../core/media/constants.ts';
import { createRateLimiter } from '../../core/network/rate-limiter.ts';

export interface RateLimiters {
  authLimiter: ReturnType<typeof createRateLimiter>;
  basicAuthLimiter: ReturnType<typeof createRateLimiter>;
  writeLimiter: ReturnType<typeof createRateLimiter>;
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

  // Specific limiter for Basic Auth that only counts failed attempts
  const basicAuthLimiter = createRateLimiter(
    RATE_LIMIT_AUTH_WINDOW_MS,
    RATE_LIMIT_AUTH_MAX_REQUESTS,
    'Too many failed authentication attempts. Please try again later.',
    { skipSuccessfulRequests: true },
  );

  const writeLimiter = createRateLimiter(
    RATE_LIMIT_WRITE_WINDOW_MS,
    RATE_LIMIT_WRITE_MAX_REQUESTS,
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
    basicAuthLimiter,
    writeLimiter,
    readLimiter,
    fileLimiter,
    streamLimiter,
  };
}
