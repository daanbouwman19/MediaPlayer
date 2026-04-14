import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Generate a unique salt for this process lifetime.
const AUTH_SALT = crypto.randomBytes(16);

// Cache for derived keys to avoid re-computation
let cachedUser: string | undefined;
let cachedSecret: string | undefined;
let cachedUserKey: Buffer | null = null;
let cachedSecretKey: Buffer | null = null;

// Helper to derive auth keys.
// We use scrypt for secure key derivation for comparison of in-memory secrets.
// This provides protection against timing attacks via fixed-length buffers
// and protects against brute-force attacks while the process is running.
function deriveAuthKey(input: string): Buffer {
  return crypto.scryptSync(input, AUTH_SALT, 32);
}

/**
 * Middleware for Basic Authentication.
 * Checks for `SYSTEM_USER` and `SYSTEM_PASSWORD` environment variables.
 * If set, enforces Basic Auth on all requests.
 */
export function basicAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const sysUser = process.env.SYSTEM_USER;
  const sysSecret = process.env.SYSTEM_PASSWORD;

  if (!sysUser || !sysSecret) {
    // Reset cache if credentials are removed
    cachedUser = undefined;
    cachedSecret = undefined;
    cachedUserKey = null;
    cachedSecretKey = null;
    return next();
  }

  // Update cache if credentials changed
  if (sysUser !== cachedUser || sysSecret !== cachedSecret) {
    cachedUser = sysUser;
    cachedSecret = sysSecret;
    cachedUserKey = deriveAuthKey(sysUser);
    cachedSecretKey = deriveAuthKey(sysSecret);
  }

  // Parse the Authorization header
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Basic (.+)$/);

  if (!match) {
    return sendUnauthorized(res);
  }

  const credentials = Buffer.from(match[1], 'base64').toString();
  // Split on the FIRST colon only to support passwords with colons
  const idx = credentials.indexOf(':');
  if (idx === -1) {
    return sendUnauthorized(res);
  }

  const loginUser = credentials.substring(0, idx);
  const loginSecret = credentials.substring(idx + 1);

  // Prevent DoS by rejecting excessively long inputs before expensive scrypt operations
  if (loginUser.length > 256 || loginSecret.length > 256) {
    return sendUnauthorized(res);
  }

  const loginKey = deriveAuthKey(loginUser);
  const secretKey = deriveAuthKey(loginSecret);

  // Safe comparison
  const userMatch =
    cachedUserKey && crypto.timingSafeEqual(cachedUserKey, loginKey);
  const secretMatch =
    cachedSecretKey && crypto.timingSafeEqual(cachedSecretKey, secretKey);

  if (userMatch && secretMatch) {
    return next();
  }

  return sendUnauthorized(res);
}

// Address Comment 2811708621: Extract 401 response logic helper
function sendUnauthorized(res: Response) {
  res.set('WWW-Authenticate', 'Basic realm="Media Player"');
  return res.status(401).send('Authentication required.');
}
