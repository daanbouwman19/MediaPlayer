import rateLimit, { Options } from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// [SECURITY] Rate Limiter Factory to prevent abuse
// Replaces the previous single-purpose limiter with a reusable one
export function createRateLimiter(
  windowMs: number,
  max: number,
  message: string,
  extraOptions?: Partial<Options>,
): RequestHandler {
  return rateLimit({
    windowMs,
    limit: max,
    message: { error: message },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    handler: (
      req: Request,
      res: Response,
      _next: NextFunction,
      options: Options,
    ) => {
      console.warn(
        `[Security] Rate limit exceeded for ${req.method} ${req.path} from ${req.ip}`,
      );
      res.status(options.statusCode).json(options.message);
    },
    ...extraOptions,
    // The `trustProxy` option should be at the top level. `validate` is for custom validation.
    // Setting to `false` uses the direct client IP. If deploying behind a reverse proxy,
    // this should be `true` and `app.set('trust proxy', 1)` should be configured in `server.ts`.
  });
}
