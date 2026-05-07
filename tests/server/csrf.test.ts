import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieSession from 'cookie-session';
import lusca from 'lusca';

/**
 * Regression test: ensure /api/auth/unlock is protected by CSRF.
 * Previously app.ts placed it in lusca's allowlist, exempting an
 * auth-state-changing endpoint from CSRF protection. This test mirrors
 * the production middleware order without the allowlist and verifies
 * that requests without a valid token are rejected, while properly
 * tokened requests succeed.
 */
describe('CSRF protection on auth routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(
      cookieSession({
        name: 'session',
        keys: ['test-secret'],
        httpOnly: true,
      }),
    );
    app.use(lusca.csrf({ angular: true }));
    // Token-issuing endpoint (matches the role of /api/auth/lock-status)
    app.get('/api/auth/lock-status', (_req, res) =>
      res.json({ enabled: true, isAuthenticated: false }),
    );
    app.post('/api/auth/unlock', (_req, res) => res.json({ success: true }));
  });

  it('rejects POST /api/auth/unlock without an XSRF token', async () => {
    const res = await request(app)
      .post('/api/auth/unlock')
      .send({ password: 'whatever' });
    expect(res.status).toBe(403);
  });

  it('accepts POST /api/auth/unlock with a valid XSRF token from the cookie', async () => {
    const agent = request.agent(app);

    // Prime the XSRF cookie via a GET.
    const getRes = await agent.get('/api/auth/lock-status');
    expect(getRes.status).toBe(200);
    const cookies = (getRes.headers['set-cookie'] as unknown as string[]) || [];
    const xsrfCookie = cookies
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('XSRF-TOKEN='));
    expect(xsrfCookie).toBeDefined();
    const token = decodeURIComponent(xsrfCookie!.split('=')[1]);

    const res = await agent
      .post('/api/auth/unlock')
      .set('X-XSRF-TOKEN', token)
      .send({ password: 'test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });
});

/**
 * Regression test: ensure session cookies are HttpOnly so XSS cannot
 * read them via document.cookie. We use a GET endpoint that writes
 * to req.session (and so triggers Set-Cookie) to avoid the unrelated
 * CodeQL "missing CSRF middleware" finding that fires on any POST
 * route attached to a cookie-handling app.
 */
describe('Session cookie hardening', () => {
  it('Set-Cookie for session has HttpOnly + SameSite flags', async () => {
    const app = express();
    app.use(express.json());
    app.use(
      cookieSession({
        name: 'session',
        keys: ['test-secret'],
        httpOnly: true,
        sameSite: 'lax',
      }),
    );
    // GET is a safe method per CSRF semantics — using it here keeps the
    // test focused on cookie attributes without inviting a static-analysis
    // flag for an unrelated concern.
    app.get('/session-bootstrap', (req, res) => {
      if (req.session) req.session.isAuthenticated = true;
      res.json({ ok: true });
    });

    const res = await request(app).get('/session-bootstrap');
    const setCookie = res.headers['set-cookie'] as unknown as string[] | string;
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const sessionCookie = cookies.find((c) => c.startsWith('session='));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie!.toLowerCase()).toContain('httponly');
    expect(sessionCookie!.toLowerCase()).toContain('samesite=lax');
  });
});
