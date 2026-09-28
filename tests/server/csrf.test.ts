import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import https from 'https';
import request from 'supertest';
import { generate } from 'selfsigned';
import { createApp } from '../../src/server/app';
import { createTestMediaService } from '../utils/test-factory';

// Only the database is faked (so no worker or DB file is created); the
// middleware stack and the auth routes are the real ones from createApp.
vi.mock('../../src/core/database/database');

/**
 * CSRF protection and session cookies, tested through the real createApp
 * over HTTPS: the session cookie is `Secure`, so cookie-session (and with it
 * lusca's token secret) only persists over an encrypted connection.
 * Regression: /api/auth/unlock used to be on lusca's allowlist.
 */
describe('CSRF protection and session cookies (real app)', () => {
  const originalEnv = { ...process.env };
  let tls: { key: string; cert: string };
  let server: https.Server;

  beforeAll(async () => {
    // commonName 'localhost' also adds 127.0.0.1 as subjectAltName.
    const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
      keyType: 'ec',
      algorithm: 'sha256',
    });
    tls = { key: pems.private, cert: pems.cert };
  });

  async function startServer(options: { csrf?: boolean } = { csrf: true }) {
    const { service } = createTestMediaService();
    const app = await createApp(service, options);
    server = https.createServer(tls, app);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    return server;
  }

  /** Cookie name=value pairs and raw Set-Cookie headers of a response. */
  function setCookies(res: request.Response): string[] {
    const header = res.headers['set-cookie'] as unknown as
      | string[]
      | string
      | undefined;
    if (!header) return [];
    return Array.isArray(header) ? header : [header];
  }

  function xsrfToken(res: request.Response): string {
    const cookie = setCookies(res)
      .map((c) => c.split(';')[0]!)
      .find((c) => c.startsWith('XSRF-TOKEN='));
    expect(cookie).toBeDefined();
    return decodeURIComponent(cookie!.slice('XSRF-TOKEN='.length));
  }

  beforeEach(() => {
    delete process.env.GLOBAL_PASSWORD;
    delete process.env.SYSTEM_USER;
    delete process.env.SYSTEM_PASSWORD;
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await new Promise<void>((resolve) => {
      if (server?.listening) server.close(() => resolve());
      else resolve();
    });
  });

  it('rejects a state-changing request without an XSRF token', async () => {
    await startServer();

    const res = await request(server)
      .post('/api/auth/unlock')
      .ca(tls.cert)
      .send({ password: 'whatever' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid or missing CSRF token' });
  });

  it('rejects a state-changing request with a forged XSRF token', async () => {
    await startServer();
    const agent = request.agent(server).ca(tls.cert);
    await agent.get('/api/auth/lock-status').expect(200);

    const res = await agent
      .post('/api/auth/unlock')
      .set('X-XSRF-TOKEN', 'forged-token')
      .send({ password: 'whatever' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Invalid or missing CSRF token' });
  });

  it('accepts the request with the token from the XSRF-TOKEN cookie', async () => {
    await startServer();
    const agent = request.agent(server).ca(tls.cert);
    const statusRes = await agent.get('/api/auth/lock-status').expect(200);

    const res = await agent
      .post('/api/auth/unlock')
      .set('X-XSRF-TOKEN', xsrfToken(statusRes))
      .send({ password: 'whatever' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('issues a Secure, HttpOnly, SameSite=Lax session cookie on unlock', async () => {
    process.env.GLOBAL_PASSWORD = 'correct horse';
    await startServer();
    const agent = request.agent(server).ca(tls.cert);
    const statusRes = await agent.get('/api/auth/lock-status').expect(200);
    expect(statusRes.body).toEqual({ enabled: true, isAuthenticated: false });

    const unlockRes = await agent
      .post('/api/auth/unlock')
      .set('X-XSRF-TOKEN', xsrfToken(statusRes))
      .send({ password: 'correct horse' });
    expect(unlockRes.status).toBe(200);

    const sessionCookie = setCookies(unlockRes).find((c) =>
      c.startsWith('session='),
    );
    expect(sessionCookie).toBeDefined();
    const attributes = sessionCookie!
      .split(';')
      .slice(1)
      .map((a) => a.trim().toLowerCase());
    expect(attributes).toContain('secure');
    expect(attributes).toContain('httponly');
    expect(attributes).toContain('samesite=lax');

    const afterRes = await agent.get('/api/auth/lock-status').expect(200);
    expect(afterRes.body).toEqual({ enabled: true, isAuthenticated: true });
  });

  it('skips CSRF only when createApp is told to', async () => {
    await startServer({ csrf: false });

    const res = await request(server)
      .post('/api/auth/unlock')
      .ca(tls.cert)
      .send({ password: 'whatever' });

    expect(res.status).toBe(200);
    expect(setCookies(res).some((c) => c.startsWith('XSRF-TOKEN='))).toBe(
      false,
    );
  });
});
