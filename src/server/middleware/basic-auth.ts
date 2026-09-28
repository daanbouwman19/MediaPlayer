import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  MAX_PASSWORD_LENGTH,
  RATE_LIMIT_AUTH_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
} from '../../core/media/constants.ts';

// Per-process key for comparing credentials as HMAC-SHA256 digests. The
// expected credentials live in memory, so a slow KDF on every request adds
// nothing but blocked event-loop time; fixed-length digests compared with
// timingSafeEqual keep the comparison constant-time for any input length.
const DIGEST_KEY = crypto.randomBytes(32);

function digest(value: string): Buffer {
  return crypto.createHmac('sha256', DIGEST_KEY).update(value, 'utf8').digest();
}

interface ExpectedCredentials {
  user: string;
  secret: string;
  userDigest: Buffer;
  secretDigest: Buffer;
}

// Derived once per configuration, not per request.
let expected: ExpectedCredentials | null = null;

function getExpectedCredentials(
  user: string,
  secret: string,
): ExpectedCredentials {
  if (!expected || expected.user !== user || expected.secret !== secret) {
    expected = {
      user,
      secret,
      userDigest: digest(user),
      secretDigest: digest(secret),
    };
  }
  return expected;
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

/** Resets the failed-attempt counters and cached credentials (tests). */
export function resetBasicAuthState(): void {
  failedAttempts.clear();
  expected = null;
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
    // Reset cache if credentials are removed
    expected = null;
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

  const { userDigest, secretDigest } = getExpectedCredentials(
    sysUser,
    sysSecret,
  );
  // Compare both parts unconditionally so timing does not reveal which one
  // matched.
  const userMatch = crypto.timingSafeEqual(userDigest, digest(loginUser));
  const secretMatch = crypto.timingSafeEqual(secretDigest, digest(loginSecret));

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
