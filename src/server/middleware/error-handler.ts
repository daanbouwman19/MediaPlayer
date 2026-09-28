/**
 * @file Express error handler middleware.
 */
import { STATUS_CODES } from 'http';
import type { ErrorRequestHandler, Response } from 'express';
import { AppError } from '../../core/media/errors.ts';

interface HttpLikeError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
  expose?: unknown;
  message?: unknown;
}

function isErrorStatus(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 400 &&
    value < 600
  );
}

/**
 * Picks the status for an error that is not an AppError: the status carried by
 * http-errors style errors (body-parser: 400 for malformed JSON, 413; send:
 * 404), or one a middleware set before failing (lusca's CSRF check sets 403
 * and then passes a plain Error). Anything else is a 500.
 *
 * Only http-errors (recognisable by their boolean `expose`) describe the
 * client's own request. Other errors can carry the status of an upstream
 * response instead: a GaxiosError has the status Google answered with.
 */
function statusOf(err: HttpLikeError, res: Response): number {
  if (typeof err.expose === 'boolean') {
    if (isErrorStatus(err.status)) return err.status;
    if (isErrorStatus(err.statusCode)) return err.statusCode;
  }
  if (err.type === 'entity.too.large') return 413;
  if (isErrorStatus(res.statusCode)) return res.statusCode;
  return 500;
}

function resolveStatus(err: HttpLikeError, res: Response): number {
  const status = statusOf(err, res);
  // The web client reads every 401 as the global-password lock and reloads
  // the page, so only the auth middlewares (and AppErrors) may answer 401.
  return status === 401 ? 500 : status;
}

const LUSCA_CSRF_ERROR = /^CSRF token (?:missing|mismatch)$/;

/**
 * Answers a CSRF rejection with a JSON 403 the client can show. lusca's check
 * sets 403 and passes a plain Error ('CSRF token missing' / 'CSRF token
 * mismatch'). Mounted right after lusca, so any other error goes on to
 * {@link errorHandler}.
 */
export const csrfErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (
    !res.headersSent &&
    res.statusCode === 403 &&
    err instanceof Error &&
    LUSCA_CSRF_ERROR.test(err.message)
  ) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }
  next(err);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  // Headers already went out (e.g. a stream failed midway): let Express
  // close the connection instead of trying to write a second response.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  const error: HttpLikeError =
    typeof err === 'object' && err !== null ? (err as HttpLikeError) : {};
  const status = resolveStatus(error, res);

  if (status >= 500) {
    console.error(err);
    res.status(status).json({ error: 'Internal Server Error' });
    return;
  }

  if (status === 413) {
    res.status(413).json({ error: 'Payload Too Large' });
    return;
  }

  // Only messages meant for the client (http-errors marks those with expose)
  // are echoed; other client errors get the generic status text.
  const message =
    error.expose === true && typeof error.message === 'string' && error.message
      ? error.message
      : (STATUS_CODES[status] ?? 'Bad Request');
  res.status(status).json({ error: message });
};
