import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import request from 'supertest';
import express from 'express';
import cookieSession from 'cookie-session';
import lusca from 'lusca';
import {
  csrfErrorHandler,
  errorHandler,
} from '../../../src/server/middleware/error-handler';
import { AppError } from '../../../src/core/media/errors';

function appThrowing(err: unknown) {
  const app = express();
  app.get('/boom', () => {
    throw err;
  });
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the status and message of an AppError', async () => {
    const res = await request(appThrowing(new AppError(400, 'Bad name'))).get(
      '/boom',
    );
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Bad name' });
  });

  it('hides unexpected errors behind a logged 500', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appThrowing(new Error('db exploded'))).get(
      '/boom',
    );
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('answers 400 for malformed JSON (500 before)', async () => {
    const app = express();
    app.use(express.json());
    app.post('/echo', (req, res) => res.json(req.body));
    app.use(errorHandler);

    const res = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"a": ');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
  });

  it('answers 413 for bodies over the limit', async () => {
    const app = express();
    app.use(express.json({ limit: '10b' }));
    app.post('/echo', (req, res) => res.json(req.body));
    app.use(errorHandler);

    const res = await request(app)
      .post('/echo')
      .send({ long: 'x'.repeat(50) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Payload Too Large' });
  });

  it('keeps the 403 of a CSRF rejection (500 before)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = express();
    app.use(express.json());
    app.use(cookieSession({ name: 'session', keys: ['test-secret'] }));
    app.use(lusca.csrf({ angular: true }));
    app.post('/api/thing', (_req, res) => res.json({ ok: true }));
    app.use(errorHandler);

    const res = await request(app).post('/api/thing').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('honours status codes of http-errors style errors', async () => {
    const exposed = Object.assign(new Error('No such playlist'), {
      status: 404,
      expose: true,
    });
    const hidden = Object.assign(new Error('internal detail'), {
      statusCode: 422,
      expose: false,
    });

    const a = await request(appThrowing(exposed)).get('/boom');
    expect(a.status).toBe(404);
    expect(a.body).toEqual({ error: 'No such playlist' });

    const b = await request(appThrowing(hidden)).get('/boom');
    expect(b.status).toBe(422);
    expect(b.body).toEqual({ error: 'Unprocessable Entity' });
  });

  it('ignores upstream statuses on errors that are not http-errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Shaped like a GaxiosError: `status` is what Google answered, not a
    // verdict on the client's request.
    const upstream401 = Object.assign(new Error('unauthorized_client'), {
      status: 401,
      response: { status: 401 },
    });
    const upstream404 = Object.assign(new Error('File not found'), {
      status: 404,
      statusCode: 404,
    });

    const a = await request(appThrowing(upstream401)).get('/boom');
    expect(a.status).toBe(500);
    expect(a.body).toEqual({ error: 'Internal Server Error' });

    const b = await request(appThrowing(upstream404)).get('/boom');
    expect(b.status).toBe(500);
    expect(b.body).toEqual({ error: 'Internal Server Error' });
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });

  it('never answers 401 for errors that are not AppErrors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // The web client treats any 401 as the global-password lock and reloads.
    const httpError401 = Object.assign(new Error('Unauthorized'), {
      status: 401,
      expose: true,
    });
    const preset401 = express();
    preset401.get('/boom', (_req, res) => {
      res.status(401);
      throw new Error('failed after setting 401');
    });
    preset401.use(errorHandler);

    const a = await request(appThrowing(httpError401)).get('/boom');
    expect(a.status).toBe(500);

    const b = await request(preset401).get('/boom');
    expect(b.status).toBe(500);

    const c = await request(appThrowing(new AppError(401, 'Locked'))).get(
      '/boom',
    );
    expect(c.status).toBe(401);
  });

  it('treats non-error throwables as a 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(appThrowing('just a string')).get('/boom');
    expect(res.status).toBe(500);
  });

  it('leaves responses whose headers were already sent to Express', () => {
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn() } as any;
    const err = new Error('stream failed');

    errorHandler(err, {} as any, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('csrfErrorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function csrfApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieSession({ name: 'session', keys: ['test-secret'] }));
    app.use(lusca.csrf({ angular: true }));
    app.use(csrfErrorHandler);
    app.post('/api/thing', (_req, res) => res.json({ ok: true }));
    app.get('/api/fail', () => {
      throw new AppError(404, 'Gone');
    });
    app.use(errorHandler);
    return app;
  }

  it('answers a missing or wrong token with a JSON 403', async () => {
    const app = csrfApp();
    const missing = await request(app).post('/api/thing').send({});
    expect(missing.status).toBe(403);
    expect(missing.body).toEqual({ error: 'Invalid or missing CSRF token' });

    const wrong = await request(app)
      .post('/api/thing')
      .set('X-XSRF-TOKEN', 'forged')
      .send({});
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ error: 'Invalid or missing CSRF token' });
  });

  it('passes other errors on to the error handler', async () => {
    const next = vi.fn();
    const err = new Error('CSRF token missing');
    // Not a CSRF rejection without lusca's 403.
    csrfErrorHandler(
      err,
      {} as any,
      { headersSent: false, statusCode: 200 } as any,
      next,
    );
    expect(next).toHaveBeenCalledWith(err);

    const res = await request(csrfApp()).get('/api/fail');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Gone' });
  });
});
