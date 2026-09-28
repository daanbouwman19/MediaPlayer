/**
 * Helpers for test apps that, like createApp(), put lusca's CSRF check behind
 * cookie-session: a client first loads a page to get its session and
 * XSRF-TOKEN cookie, then sends the token back in the X-XSRF-TOKEN header.
 */
import request from 'supertest';
import cookieSession from 'cookie-session';
import lusca from 'lusca';
import type { Express } from 'express';

const TOKEN_COOKIE = 'XSRF-TOKEN';

/** A browser's state after loading the app: its cookies and CSRF token. */
export interface CsrfSession {
  /** The Cookie header value (session cookies, without the token cookie). */
  cookies: string;
  token: string;
}

/**
 * Mounts the session cookie and the CSRF check the way createApp() does.
 */
export function useSessionWithCsrf(app: Express, keys: string[]): void {
  app.use(cookieSession({ name: 'session', keys, httpOnly: true }));
  app.use(lusca.csrf({ angular: true }));
}

/** The name=value pairs of a response's Set-Cookie headers. */
export function setCookiePairs(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (header ?? []).map((c) => c.split(';')[0] ?? '');
}

/**
 * Starts a session by loading `path` (a GET the app answers while locked)
 * and returns its cookies and CSRF token.
 */
export async function startCsrfSession(
  app: Express,
  path = '/api/auth/lock-status',
): Promise<CsrfSession> {
  const res = await request(app).get(path);
  const pairs = setCookiePairs(res);
  const tokenPair = pairs.find((p) => p.startsWith(`${TOKEN_COOKIE}=`));
  if (!tokenPair) throw new Error(`${path} set no ${TOKEN_COOKIE} cookie`);
  return {
    cookies: pairs.filter((p) => p !== tokenPair).join('; '),
    token: decodeURIComponent(tokenPair.slice(TOKEN_COOKIE.length + 1)),
  };
}

/** A POST carrying the session's cookies and CSRF token. */
export function postWithCsrf(
  app: Express,
  path: string,
  session: CsrfSession,
  cookies: string = session.cookies,
): request.Test {
  return request(app)
    .post(path)
    .set('Cookie', cookies)
    .set('X-XSRF-TOKEN', session.token);
}
