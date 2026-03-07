import { Request, Response, NextFunction } from 'express';

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

  if (!req.session?.isAuthenticated) {
    return res.status(401).json({ error: 'Locked', isLocked: true });
  }

  return next();
}
