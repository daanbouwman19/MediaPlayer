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
        if (req.session?.isAuthenticated) {
          isAuthenticated = true;
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

      // Timing-safe comparison using scrypt to protect against brute-force and timing attacks
      // Note: We use the same random salt for both because the "stored" password is in memory,
      // not in a database. This prevents timing attacks on the length/content of the password
      // while making brute-force more expensive than simple string comparison.
      if (typeof password === 'string') {
        const salt = crypto.randomBytes(16);

        try {
          const scryptAsync = (pwd: string, slt: Buffer, keylen: number) =>
            new Promise<Buffer>((resolve, reject) => {
              crypto.scrypt(pwd, slt, keylen, (err, derivedKey) => {
                if (err) reject(err);
                else resolve(derivedKey);
              });
            });

          const [inputHash, targetHash] = await Promise.all([
            scryptAsync(password, salt, 32),
            scryptAsync(globalPassword, salt, 32),
          ]);

          if (crypto.timingSafeEqual(inputHash, targetHash)) {
            if (req.session) {
              req.session.isAuthenticated = true;
            }
            return res.json({ success: true });
          }
        } catch (e) {
          return res
            .status(500)
            .json({ error: 'Internal server error during authentication' });
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
