import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  MAX_PASSWORD_LENGTH,
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
} from '../../core/media/constants.ts';

// Longest UTF-8 encoding of one credential part: the decoded header is capped
// at MAX_PASSWORD_LENGTH * 2 + 1 UTF-16 code units, each at most 3 bytes.
const MAX_CREDENTIAL_BYTES = (MAX_PASSWORD_LENGTH * 2 + 1) * 3;

/**
 * Compares a submitted credential with the configured one in constant time,
 * without hashing either: both are zero-padded to the same fixed size (no
 * smaller than any accepted submission) and compared with timingSafeEqual,
 * so the time taken does not depend on the submitted value or its length.
 * The byte lengths are compared separately, since padding hides a trailing
 * NUL. Nothing derived from the credentials is kept.
 */
function credentialMatches(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(actual, 'utf8');
  const size = Math.max(
    MAX_CREDENTIAL_BYTES,
    expectedBytes.length,
    actualBytes.length,
  );
  const expectedPadded = Buffer.alloc(size);
  const actualPadded = Buffer.alloc(size);
  expectedBytes.copy(expectedPadded);
  actualBytes.copy(actualPadded);
  const sameBytes = crypto.timingSafeEqual(expectedPadded, actualPadded);
  return sameBytes && expectedBytes.length === actualBytes.length;
}

/**
 * Counts rejected credentials per client within a fixed window. Only actual
 * credential failures count: 4xx/5xx responses and aborted range requests of
 * authenticated clients do not lock anyone out.
 */
class FailedAttemptTracker {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
  ) {}

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (now >= entry.resetAt) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (entry && now < entry.resetAt) {
      entry.count++;
      return;
    }
    this.prune(now);
    this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
  }

  clear(): void {
    this.attempts.clear();
  }

  private prune(now: number): void {
    if (this.attempts.size < 10_000) return;
    for (const [key, entry] of this.attempts) {
      if (now >= entry.resetAt) this.attempts.delete(key);
    }
  }
}

const failedAttempts = new FailedAttemptTracker(
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
);

let misconfigurationLogged = false;

/** Resets the failed-attempt counters (tests). */
export function resetBasicAuthState(): void {
  failedAttempts.clear();
  misconfigurationLogged = false;
}

/**
 * Middleware for Basic Authentication.
 * Checks for `SYSTEM_USER` and `SYSTEM_PASSWORD` environment variables.
 * If set, enforces Basic Auth on all requests. If only one of them is set,
 * every request is rejected: a half-configured login must not silently
 * leave the server open.
 */
export function basicAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const sysUser = process.env.SYSTEM_USER || '';
  const sysSecret = process.env.SYSTEM_PASSWORD || '';

  if (!sysUser && !sysSecret) {
    return next();
  }

  if (!sysUser || !sysSecret) {
    if (!misconfigurationLogged) {
      misconfigurationLogged = true;
      console.error(
        '[Security] Basic Auth is misconfigured: set both SYSTEM_USER and SYSTEM_PASSWORD (or neither). Rejecting all requests.',
      );
    }
    return res
      .status(500)
      .json({ error: 'Server authentication is misconfigured' });
  }

  const clientKey = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  if (failedAttempts.isBlocked(clientKey)) {
    // Checked before the credentials, so a locked-out client cannot tell a
    // correct guess from a wrong one.
    return res.status(429).json({
      error: 'Too many failed authentication attempts. Please try again later.',
    });
  }

  // Parse the Authorization header
  const authHeader = req.headers.authorization || '';
  const encoded = authHeader.match(/^Basic (.+)$/)?.[1];

  if (!encoded) {
    // No credentials yet (the browser's first request): a challenge, not a
    // failed attempt.
    return sendUnauthorized(res);
  }

  const credentials = Buffer.from(encoded, 'base64').toString();

  // Prevent DoS by rejecting excessively long inputs before hashing and substring allocations
  const idx = credentials.indexOf(':');
  if (credentials.length > MAX_PASSWORD_LENGTH * 2 + 1 || idx === -1) {
    // user:secret
    failedAttempts.recordFailure(clientKey);
    return sendUnauthorized(res);
  }

  // Split on the FIRST colon only to support passwords with colons
  const loginUser = credentials.substring(0, idx);
  const loginSecret = credentials.substring(idx + 1);

  // Compare both parts unconditionally so timing does not reveal which one
  // matched.
  const userMatch = credentialMatches(sysUser, loginUser);
  const secretMatch = credentialMatches(sysSecret, loginSecret);

  if (userMatch && secretMatch) {
    return next();
  }

  failedAttempts.recordFailure(clientKey);
  return sendUnauthorized(res);
}

// Address Comment 2811708621: Extract 401 response logic helper
function sendUnauthorized(res: Response) {
  res.set('WWW-Authenticate', 'Basic realm="Media Player"');
  return res.status(401).send('Authentication required.');
}
