import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * How long an unlocked session stays valid. Also the session cookie's maxAge,
 * but enforced server-side too: the cookie's expiry alone is up to the client.
 */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Keys the GLOBAL_PASSWORD fingerprint stored in unlocked sessions. The
// session payload is readable by the client, so a plain hash would allow an
// offline guess of the password. createApp() derives this key from the
// cookie-session secret, so unlocked sessions survive a restart whenever
// SESSION_SECRET is configured.
let fingerprintKey = crypto.randomBytes(32);

/**
 * Sets the key used to fingerprint GLOBAL_PASSWORD in unlocked sessions.
 * @param sessionSecret - The secret that signs the session cookie.
 */
export function setSessionFingerprintKey(sessionSecret: string): void {
  fingerprintKey = crypto
    .createHmac('sha256', sessionSecret)
    .update('media-player:global-password-session')
    .digest();
}

/**
 * Returns a random secret for signing session cookies when SESSION_SECRET is
 * not configured (non-production only; production refuses to start without
 * one). A fixed fallback key would let anyone forge an unlocked session.
 */
export function createEphemeralSessionSecret(): string {
  console.warn(
    '[Security] SESSION_SECRET is not set; signing sessions with a random per-process secret. Sessions end when the server restarts.',
  );
  return crypto.randomBytes(32).toString('hex');
}

function passwordFingerprint(password: string): string {
  return crypto
    .createHmac('sha256', fingerprintKey)
    .update(password, 'utf8')
    .digest('base64url');
}

/**
 * Marks the session as unlocked, bound to the current password and time.
 */
export function markSessionUnlocked(req: Request, password: string): void {
  if (!req.session) return;
  req.session.isAuthenticated = true;
  req.session.authAt = Date.now();
  req.session.passwordFingerprint = passwordFingerprint(password);
}

/**
 * Checks whether the session was unlocked with the current GLOBAL_PASSWORD
 * within the last {@link SESSION_MAX_AGE_MS}. Sessions from before a password
 * change, expired sessions and legacy sessions (isAuthenticated only) fail.
 */
export function isSessionUnlocked(req: Request, password: string): boolean {
  const session = req.session;
  if (!session || session.isAuthenticated !== true) return false;

  const authAt: unknown = session.authAt;
  if (typeof authAt !== 'number' || !Number.isFinite(authAt)) return false;
  const age = Date.now() - authAt;
  if (age < 0 || age > SESSION_MAX_AGE_MS) return false;

  const stored: unknown = session.passwordFingerprint;
  if (typeof stored !== 'string') return false;
  const actual = Buffer.from(stored);
  const wanted = Buffer.from(passwordFingerprint(password));
  return (
    actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted)
  );
}

// Reachable while locked. '/api/auth/google-drive/start' is deliberately not
// here: it resets the pending OAuth state, so only an unlocked client may
// start linking Drive.
const BYPASS_ROUTES = new Set([
  '/api/auth/unlock',
  '/api/auth/lock',
  '/api/auth/lock-status',
  '/auth/google/callback',
  '/',
  '/index.html',
  '/favicon.ico',
]);

/**
 * Middleware to enforce a global password lock.
 */
export function globalPasswordMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const globalPassword = process.env.GLOBAL_PASSWORD;

  if (!globalPassword) {
    return next();
  }

  if (BYPASS_ROUTES.has(req.path) || req.path.startsWith('/assets/')) {
    return next();
  }

  if (!isSessionUnlocked(req, globalPassword)) {
    // Drop an expired or stale session so the browser discards the cookie.
    if (req.session?.isAuthenticated) {
      req.session = null;
    }
    return res.status(401).json({ error: 'Locked', isLocked: true });
  }

  return next();
}
