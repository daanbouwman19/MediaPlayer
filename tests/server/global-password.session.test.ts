/**
 * Global-password sessions are bound to the password they were unlocked with
 * and expire server-side; the lock can be re-engaged; and starting a Drive
 * link (which resets the pending OAuth state) requires an unlocked session.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import request from 'supertest';
import express from 'express';
import cookieSession from 'cookie-session';
import { createAuthRoutes } from '../../src/server/routes/auth.routes';
import {
  globalPasswordMiddleware,
  SESSION_MAX_AGE_MS,
  setSessionFingerprintKey,
} from '../../src/server/middleware/global-password';
import { generateAuthUrl } from '../../src/infrastructure/google-auth';

vi.mock('../../src/infrastructure/google-auth', () => ({
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.example/auth'),
  authenticateWithCode: vi.fn(),
  checkGoogleDriveAuth: vi.fn(),
  getPendingAuthState: vi.fn(),
}));

const passThrough = (_req: any, _res: any, next: any) => next();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieSession({ name: 'session', keys: ['test-secret'] }));
  app.use(globalPasswordMiddleware);
  app.use(createAuthRoutes({ authLimiter: passThrough } as any));
  app.get('/api/protected', (_req, res) => res.json({ ok: true }));
  return app;
}

function cookiesOf(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (header ?? []).map((c) => c.split(';')[0]).join('; ');
}

/**
 * Applies a response's Set-Cookie headers to a Cookie header value the way a
 * browser updates its jar: expired or emptied cookies are dropped, others
 * replaced or added.
 */
function applySetCookies(jar: string, res: request.Response): string {
  const cookies = new Map<string, string>();
  for (const pair of jar.split('; ').filter(Boolean)) {
    const eq = pair.indexOf('=');
    cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  for (const setCookie of header ?? []) {
    const [pair = '', ...attributes] = setCookie.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expires = attributes
      .map((a) => a.trim())
      .find((a) => a.toLowerCase().startsWith('expires='));
    const expired =
      expires !== undefined &&
      Date.parse(expires.slice('expires='.length)) <= Date.now();
    if (expired || value === '') cookies.delete(name);
    else cookies.set(name, value);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function unlock(app: express.Express, password: string) {
  const res = await request(app).post('/api/auth/unlock').send({ password });
  expect(res.status).toBe(200);
  return cookiesOf(res);
}

describe('global password sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSessionFingerprintKey('test-secret');
    vi.stubEnv('GLOBAL_PASSWORD', 'first-password');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('unlocks the API for the current password', async () => {
    const app = buildApp();
    const cookies = await unlock(app, 'first-password');

    const res = await request(app).get('/api/protected').set('Cookie', cookies);
    expect(res.status).toBe(200);
  });

  it('ends existing sessions when GLOBAL_PASSWORD changes', async () => {
    const app = buildApp();
    const cookies = await unlock(app, 'first-password');

    vi.stubEnv('GLOBAL_PASSWORD', 'rotated-password');

    const res = await request(app).get('/api/protected').set('Cookie', cookies);
    expect(res.status).toBe(401);
    const status = await request(app)
      .get('/api/auth/lock-status')
      .set('Cookie', cookies);
    expect(status.body).toEqual({ enabled: true, isAuthenticated: false });
  });

  it('expires sessions server-side after the maximum age', async () => {
    const app = buildApp();
    const cookies = await unlock(app, 'first-password');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + SESSION_MAX_AGE_MS + 1000);

    const res = await request(app).get('/api/protected').set('Cookie', cookies);
    expect(res.status).toBe(401);
  });

  it('rejects legacy sessions that only carry isAuthenticated', async () => {
    const app = express();
    app.use(cookieSession({ name: 'session', keys: ['test-secret'] }));
    app.get('/legacy-login', (req, res) => {
      // What unlocking used to store.
      req.session!.isAuthenticated = true;
      res.end();
    });
    app.use(globalPasswordMiddleware);
    app.get('/api/protected', (_req, res) => res.json({ ok: true }));

    const login = await request(app).get('/legacy-login');
    const res = await request(app)
      .get('/api/protected')
      .set('Cookie', cookiesOf(login));
    expect(res.status).toBe(401);
  });

  it('locks again via POST /api/auth/lock', async () => {
    const app = buildApp();
    const cookies = await unlock(app, 'first-password');

    const lock = await request(app)
      .post('/api/auth/lock')
      .set('Cookie', cookies);
    expect(lock.status).toBe(200);
    expect(lock.headers['set-cookie']).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^session=;.*expires=Thu, 01 Jan 1970/i),
      ]),
    );

    // What the browser sends next: the unlock cookies, updated by the lock
    // response. A lock route that left the session alone would get a 200.
    const jar = applySetCookies(cookies, lock);
    const res = await request(app).get('/api/protected').set('Cookie', jar);
    expect(res.status).toBe(401);
  });

  it('does not let a locked client start the Drive OAuth flow', async () => {
    const app = buildApp();

    const locked = await request(app).get('/api/auth/google-drive/start');
    expect(locked.status).toBe(401);
    expect(generateAuthUrl).not.toHaveBeenCalled();

    const cookies = await unlock(app, 'first-password');
    const unlocked = await request(app)
      .get('/api/auth/google-drive/start')
      .set('Cookie', cookies);
    expect(unlocked.status).toBe(200);
    expect(generateAuthUrl).toHaveBeenCalledTimes(1);
  });

  it('does not store the password itself in the readable session cookie', async () => {
    const app = buildApp();
    const cookies = await unlock(app, 'first-password');
    const value = /session=([^;]+)/.exec(cookies)?.[1] ?? '';
    const payload = Buffer.from(value, 'base64').toString('utf8');

    expect(payload).not.toContain('first-password');
    expect(JSON.parse(payload)).toMatchObject({
      isAuthenticated: true,
      authAt: expect.any(Number),
      passwordFingerprint: expect.any(String),
    });
  });
});
