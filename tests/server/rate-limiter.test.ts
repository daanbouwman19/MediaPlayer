import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from '../../src/core/network/rate-limiter';
import type { Request, Response, NextFunction } from 'express';

describe('createRateLimiter', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    req = {
      ip: '127.0.0.1',
      method: 'GET',
      path: '/test',
      headers: {},
      app: {
        get: vi.fn().mockReturnValue(false),
      } as any,
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    };
    next = vi.fn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow requests within limit', async () => {
    const limiter = createRateLimiter(1000, 2, 'Limit exceeded');

    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('should block requests over limit', async () => {
    const limiter = createRateLimiter(1000, 1, 'Limit exceeded');

    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1); // Should not increase
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({ error: 'Limit exceeded' });
  });

  it('should reset limit after windowMs', async () => {
    const windowMs = 1000;
    const limiter = createRateLimiter(windowMs, 1, 'Limit exceeded');

    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Advance time
    // Note: The rate limiter checks Date.now(), so we need to advance system time too
    vi.setSystemTime(Date.now() + windowMs + 100);

    // Also advance timers for the cleanup interval, though it's not strictly needed for the reset logic itself
    // which checks 'now > data.resetTime' inside the request handler.
    vi.advanceTimersByTime(windowMs + 100);

    // Should be allowed again
    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('should track different IPs separately', async () => {
    const limiter = createRateLimiter(1000, 1, 'Limit exceeded');

    await limiter(req as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Different IP
    const req2 = { ...req, ip: '192.168.1.1' };
    await limiter(req2 as Request, res as Response, next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
