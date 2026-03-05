import { describe, it, expect, vi } from 'vitest';
import { globalPasswordMiddleware } from '../../src/server/middleware/global-password';
import { Request, Response } from 'express';

describe('globalPasswordMiddleware', () => {
  it('should allow request if GLOBAL_PASSWORD is not set', () => {
    const req = { path: '/api/media', headers: {} } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    process.env.GLOBAL_PASSWORD = '';
    globalPasswordMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should block request if locked and no cookie provided', () => {
    const req = { path: '/api/media', headers: {} } as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as unknown as Response;
    const next = vi.fn();

    process.env.GLOBAL_PASSWORD = 'secret-password';
    globalPasswordMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('should allow bypass routes', () => {
    const req = { path: '/api/auth/unlock', headers: {} } as Request;
    const res = {} as Response;
    const next = vi.fn();

    process.env.GLOBAL_PASSWORD = 'secret-password';
    globalPasswordMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
