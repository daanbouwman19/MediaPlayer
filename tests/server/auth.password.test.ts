import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createAuthRoutes } from '../../src/server/routes/auth.routes';
import {
  globalPasswordMiddleware,
  generateSessionToken,
} from '../../src/server/middleware/global-password';

const mockLimiters = {
  authLimiter: (_req: any, _res: any, next: any) => next(),
  apiLimiter: (_req: any, _res: any, next: any) => next(),
} as any;

describe('Global Password Auth Routes & Middleware', () => {
  let app: express.Express;
  const originalEnv = process.env.GLOBAL_PASSWORD;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(globalPasswordMiddleware);
    app.use(createAuthRoutes(mockLimiters));

    // Add a protected test route
    app.get('/api/protected', (_req, res) => res.json({ success: true }));
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GLOBAL_PASSWORD = originalEnv;
    } else {
      delete process.env.GLOBAL_PASSWORD;
    }
    vi.clearAllMocks();
  });

  it('middleware allows access to BypassRoutes when locked', async () => {
    process.env.GLOBAL_PASSWORD = 'test';

    // bypass route
    const res = await request(app).get('/api/auth/lock-status');
    expect(res.status).toBe(200);
  });

  it('middleware returns 401 for protected routes without cookie', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app).get('/api/protected');
    expect(res.status).toBe(401);
    expect(res.body.isLocked).toBe(true);
  });

  it('middleware returns 401 for protected routes with invalid cookie format', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app)
      .get('/api/protected')
      .set('Cookie', 'media_session=invalidhex');
    expect(res.status).toBe(401);
    expect(res.body.isLocked).toBe(true);
  });

  it('middleware returns 401 for protected routes with incorrect session token', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const wrongToken = generateSessionToken('wrong');
    const res = await request(app)
      .get('/api/protected')
      .set('Cookie', `media_session=${wrongToken}`);
    expect(res.status).toBe(401);
  });

  it('middleware allows access to protected routes with correct session token', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const validToken = generateSessionToken('test');
    const res = await request(app)
      .get('/api/protected')
      .set('Cookie', `media_session=${validToken}`);
    expect(res.status).toBe(200);
  });

  // Test /api/auth/lock-status
  it('lock-status returns disabled when GLOBAL_PASSWORD is not set', async () => {
    delete process.env.GLOBAL_PASSWORD;
    const res = await request(app).get('/api/auth/lock-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, isAuthenticated: true });
  });

  it('lock-status returns locked when no cookie is present', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app).get('/api/auth/lock-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, isAuthenticated: false });
  });

  it('lock-status returns authenticated when bad cookie is present', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const wrongToken = generateSessionToken('wrong');
    const res = await request(app)
      .get('/api/auth/lock-status')
      .set('Cookie', `media_session=${wrongToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, isAuthenticated: false });
  });

  it('lock-status returns authenticated when correct cookie is present', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const validToken = generateSessionToken('test');
    const res = await request(app)
      .get('/api/auth/lock-status')
      .set('Cookie', `media_session=${validToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, isAuthenticated: true });
  });

  // Test /api/auth/unlock
  it('unlock succeeds automatically if global password is not set', async () => {
    delete process.env.GLOBAL_PASSWORD;
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'any' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('unlock succeeds with correct password and sets cookie', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // check cookie is set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies[0]).toContain('media_session=');
    expect(cookies[0]).toContain('HttpOnly');
  });

  it('unlock fails with incorrect password', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid password');
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeUndefined(); // shouldn't set secure session
  });

  it('unlock fails with non-string password', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ password: {} });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid password');
  });

  it('parseCookies coverage: handles multiple cookies correctly', async () => {
    process.env.GLOBAL_PASSWORD = 'test';
    const validToken = generateSessionToken('test');
    const res = await request(app)
      .get('/api/auth/lock-status')
      .set('Cookie', `other=123; media_session=${validToken}; final=abc`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, isAuthenticated: true });
  });

  it('parseCookies coverage: handles missing cookie header gracefully', async () => {
    // Already covered by tests that don't send a cookie, but explicit check
    process.env.GLOBAL_PASSWORD = 'test';
    const res = await request(app).get('/api/auth/lock-status');
    expect(res.status).toBe(200);
    expect(res.body.isAuthenticated).toBe(false);
  });
});
