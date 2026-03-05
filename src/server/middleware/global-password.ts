import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * Store active, randomized session tokens.
 */
const activeSessions = new Set<string>();

/**
 * Helper to validate if a session token is active.
 */
export function isValidSession(token: string): boolean {
  return activeSessions.has(token);
}

/**
 * Generate a cryptographically secure random session token.
 */
export function generateSessionToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);
  return token;
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
    '/',
    '/index.html',
    '/favicon.ico',
  ];
  if (bypassRoutes.includes(req.path) || req.path.startsWith('/assets/')) {
    return next();
  }

  const sessionToken = req.cookies?.['media_session'];

  if (!sessionToken || !isValidSession(sessionToken)) {
    return res.status(401).json({ error: 'Locked', isLocked: true });
  }

  return next();
}
