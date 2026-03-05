import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Manually parse cookies from the request header.
 */
function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const [name, ...rest] = cookie.split('=');
    const value = rest.join('=');
    if (name && value) {
      cookies[name.trim()] = value.trim();
    }
  });
  return cookies;
}

/**
 * Helper to derive a stable, fixed-length key for timing-safe comparison.
 */
function deriveToken(input: string): Buffer {
  return crypto.createHash('sha256').update(input).digest();
}

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

  const bypassRoutes = [
    '/api/auth/unlock',
    '/api/auth/lock-status',
    '/api/auth/google-drive/start',
    '/auth/google/callback',
  ];
  if (bypassRoutes.includes(req.path)) {
    return next();
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies['media_session'];

  if (!sessionToken) {
    return res.status(401).json({ error: 'Locked', isLocked: true });
  }

  try {
    const sessionBuffer = Buffer.from(sessionToken, 'hex');
    const expectedBuffer = deriveToken(globalPassword);

    // timingSafeEqual requires buffers of the same length
    if (
      sessionBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(sessionBuffer, expectedBuffer)
    ) {
      return next();
    }
  } catch (e) {
    // Fall through to error
  }

  return res.status(401).json({ error: 'Locked', isLocked: true });
}

export function generateSessionToken(password: string): string {
  return deriveToken(password).toString('hex');
}
