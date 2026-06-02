/**
 * @file Express error handler middleware.
 */
import type { ErrorRequestHandler } from 'express';
import { AppError } from '../../core/media/errors.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const errorWithStatus = err as {
    status?: number;
    statusCode?: number;
    type?: string;
  };

  if (
    errorWithStatus.status === 413 ||
    errorWithStatus.statusCode === 413 ||
    errorWithStatus.type === 'entity.too.large'
  ) {
    return res.status(413).json({ error: 'Payload Too Large' });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error(err);
  return res.status(500).json({ error: 'Internal Server Error' });
};
