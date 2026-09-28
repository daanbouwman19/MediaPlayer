/**
 * @file Error thrown by the web backend for non-2xx HTTP responses. It keeps
 * the status code so callers can tell, for example, a rejected password (401)
 * from rate limiting (429) or a server failure (5xx).
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
