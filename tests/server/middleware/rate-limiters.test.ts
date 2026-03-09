import { describe, it, expect, vi } from 'vitest';
import { createRateLimiters } from '../../../src/server/middleware/rate-limiters';
import * as rateLimiterModule from '../../../src/core/rate-limiter';
import {
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_FILE_MAX_REQUESTS,
  RATE_LIMIT_FILE_WINDOW_MS,
  RATE_LIMIT_READ_MAX_REQUESTS,
  RATE_LIMIT_READ_WINDOW_MS,
  RATE_LIMIT_WRITE_MAX_REQUESTS,
  RATE_LIMIT_WRITE_WINDOW_MS,
} from '../../../src/core/constants';

vi.mock('../../../src/core/rate-limiter');

describe('Rate Limiters Factory', () => {
  it('should create all required rate limiters with correct configuration', () => {
    const createRateLimiterSpy = vi.spyOn(
      rateLimiterModule,
      'createRateLimiter',
    );

    // Provide a dummy implementation so it returns something
    createRateLimiterSpy.mockImplementation(((
      windowMs: number,
      max: number,
      message: string,
      options?: any,
    ) => {
      return { windowMs, max, message, options };
    }) as any);

    const limiters = createRateLimiters();

    // Check authLimiter
    expect(limiters.authLimiter).toBeDefined();
    expect(createRateLimiterSpy).toHaveBeenCalledWith(
      RATE_LIMIT_AUTH_WINDOW_MS,
      RATE_LIMIT_AUTH_MAX_REQUESTS,
      'Too many auth attempts. Please try again later.',
    );

    // Check basicAuthLimiter
    expect(limiters.basicAuthLimiter).toBeDefined();
    expect(createRateLimiterSpy).toHaveBeenCalledWith(
      RATE_LIMIT_AUTH_WINDOW_MS,
      RATE_LIMIT_AUTH_MAX_REQUESTS,
      'Too many failed authentication attempts. Please try again later.',
      { skipSuccessfulRequests: true },
    );

    // Check writeLimiter
    expect(limiters.writeLimiter).toBeDefined();
    expect(createRateLimiterSpy).toHaveBeenCalledWith(
      RATE_LIMIT_WRITE_WINDOW_MS,
      RATE_LIMIT_WRITE_MAX_REQUESTS,
      'Too many requests. Please slow down.',
    );

    // Check readLimiter
    expect(limiters.readLimiter).toBeDefined();
    expect(createRateLimiterSpy).toHaveBeenCalledWith(
      RATE_LIMIT_READ_WINDOW_MS,
      RATE_LIMIT_READ_MAX_REQUESTS,
      'Too many requests. Please slow down.',
    );

    // Check fileLimiter
    expect(limiters.fileLimiter).toBeDefined();
    expect(createRateLimiterSpy).toHaveBeenCalledWith(
      RATE_LIMIT_FILE_WINDOW_MS,
      RATE_LIMIT_FILE_MAX_REQUESTS,
      'Too many requests. Please slow down.',
    );

    // Check streamLimiter
    expect(limiters.streamLimiter).toBeDefined();
    expect(createRateLimiterSpy).toHaveBeenCalledWith(
      RATE_LIMIT_FILE_WINDOW_MS,
      RATE_LIMIT_FILE_MAX_REQUESTS,
      'Too many stream requests. Please slow down.',
    );
  });
});
