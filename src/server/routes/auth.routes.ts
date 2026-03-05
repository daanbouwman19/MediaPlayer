/**
 * @file Auth routes.
 */
import { Router } from 'express';
import crypto from 'crypto';
import { AppError } from '../../core/errors.ts';
import { escapeHtml } from '../../core/security.ts';
import { getQueryParam } from '../../core/utils/http-utils.ts';
import {
  generateAuthUrl,
  authenticateWithCode,
} from '../../main/google-auth.ts';
import { getGoogleAuthSuccessPage } from '../auth-views.ts';
import type { RateLimiters } from '../middleware/rate-limiters.ts';
import { asyncHandler } from '../middleware/async-handler.ts';
import { generateSessionToken } from '../middleware/global-password.ts';

export function createAuthRoutes(limiters: RateLimiters) {
  const router = Router();

  /**
   * Check if the global password lock is enabled and current session status.
   */
  router.get(
    '/api/auth/lock-status',
    asyncHandler(async (req, res) => {
      const globalPassword = process.env.GLOBAL_PASSWORD;
      const isLocked = !!globalPassword;

      let isAuthenticated = false;
      if (isLocked) {
        const cookies: Record<string, string> = {};
        if (req.headers.cookie) {
          req.headers.cookie.split(';').forEach((cookie) => {
            const [name, ...rest] = cookie.split('=');
            if (name && rest.length) {
              cookies[name.trim()] = rest.join('=').trim();
            }
          });
        }
        const sessionToken = cookies['media_session'];
        if (sessionToken) {
          try {
            const sessionBuffer = Buffer.from(sessionToken, 'hex');
            const expectedBuffer = Buffer.from(
              generateSessionToken(globalPassword!),
              'hex',
            );
            isAuthenticated =
              sessionBuffer.length === expectedBuffer.length &&
              crypto.timingSafeEqual(sessionBuffer, expectedBuffer);
          } catch {
            // Invalid token format
          }
        }
      }

      res.json({
        enabled: isLocked,
        isAuthenticated: !isLocked || isAuthenticated,
      });
    }),
  );

  /**
   * Unlock the app with the global password.
   */
  router.post(
    '/api/auth/unlock',
    limiters.authLimiter,
    asyncHandler(async (req, res) => {
      const { password } = req.body;
      const globalPassword = process.env.GLOBAL_PASSWORD;

      if (!globalPassword) {
        return res.json({ success: true });
      }

      // Timing-safe comparison of the raw password input
      if (typeof password === 'string') {
        // We hash both to ensure they are the same length for timingSafeEqual
        const inputHash = crypto
          .createHash('sha256')
          .update(password)
          .digest();
        const targetHash = crypto
          .createHash('sha256')
          .update(globalPassword)
          .digest();

        if (crypto.timingSafeEqual(inputHash, targetHash)) {
          const token = generateSessionToken(globalPassword);
          res.cookie('media_session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict',
            maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
          });
          return res.json({ success: true });
        }
      }

      return res.status(401).json({ error: 'Invalid password' });
    }),
  );

  router.get(
    '/api/auth/google-drive/start',
    limiters.authLimiter,
    asyncHandler(async (_req, res) => {
      const url = generateAuthUrl();
      res.send(url);
    }),
  );

  router.post(
    '/api/auth/google-drive/code',
    limiters.authLimiter,
    asyncHandler(async (req, res) => {
      const { code } = req.body;
      if (!code) {
        throw new AppError(400, 'Missing code');
      }

      try {
        await authenticateWithCode(code);
        res.sendStatus(200);
      } catch (e: unknown) {
        const error = e as {
          code?: number;
          response?: { status?: number };
          message?: string;
        };
        if (
          error.code === 400 ||
          error.response?.status === 400 ||
          error.message?.includes('invalid_grant')
        ) {
          return res.status(400).json({ error: 'Invalid code' });
        }
        return res.status(500).json({ error: 'Authentication failed' });
      }
    }),
  );

  router.get(
    '/auth/google/callback',
    limiters.authLimiter,
    asyncHandler(async (req, res) => {
      const code = getQueryParam(req.query, 'code');
      if (!code || typeof code !== 'string') {
        throw new AppError(400, 'Missing or invalid code parameter');
      }

      const safeCode = escapeHtml(code);
      const nonce = res.locals.nonce as string;

      const html = getGoogleAuthSuccessPage(safeCode, nonce);
      res.send(html);
    }),
  );

  return router;
}
