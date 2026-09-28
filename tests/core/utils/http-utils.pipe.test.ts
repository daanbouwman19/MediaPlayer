// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import http from 'http';
import type { AddressInfo } from 'net';
import { PassThrough } from 'stream';
import { pipeToResponse } from '../../../src/core/network/http-utils';

/** Each test installs the handler the server runs for its next request. */
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;
let server: http.Server;
let url: string;

function get(): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  complete: boolean;
}> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false }, (res) => {
      let body = '';
      const done = () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body,
          complete: res.complete,
        });
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', done);
      res.on('error', done);
      res.on('close', done);
    });
    req.setTimeout(3000, () => req.destroy(new Error('client timeout')));
    req.on('error', reject);
  });
}

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pipeToResponse', () => {
  it('streams the source into the response', async () => {
    handler = (_req, res) => {
      const source = new PassThrough();
      res.setHeader('Content-Length', '5');
      pipeToResponse(source, res, 'Test');
      source.end('hello');
    };

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toBe('hello');
    expect(res.complete).toBe(true);
  });

  it('replies 500 without the body headers when the source fails first', async () => {
    handler = (_req, res) => {
      const source = new PassThrough();
      res.statusCode = 206;
      res.setHeader('Content-Length', '1000');
      res.setHeader('Content-Range', 'bytes 0-999/5000');
      pipeToResponse(source, res, 'Test');
      source.destroy(new Error('EBUSY'));
    };

    const res = await get();
    expect(res.status).toBe(500);
    expect(res.headers['content-length']).not.toBe('1000');
    expect(res.headers['content-range']).toBeUndefined();
    expect(res.complete).toBe(true);
    expect(console.error).toHaveBeenCalledWith(
      '[Test] Stream error:',
      expect.any(Error),
    );
  });

  it('aborts the response when the source fails mid-body', async () => {
    handler = (_req, res) => {
      const source = new PassThrough();
      res.setHeader('Content-Length', '1000');
      pipeToResponse(source, res, 'Test');
      source.write('partial');
      setTimeout(() => source.destroy(new Error('ECONNRESET')), 20);
    };

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toBe('partial');
    expect(res.complete).toBe(false);
  });

  it('destroys the source when the client disconnects', async () => {
    const source = new PassThrough();
    handler = (_req, res) => {
      pipeToResponse(source, res, 'Test');
      source.write('x');
    };

    await new Promise<void>((resolve) => {
      const req = http.get(url, { agent: false }, (res) => {
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      });
      req.on('error', () => {});
    });

    await vi.waitFor(() => expect(source.destroyed).toBe(true));
  });

  it('destroys the source right away for an already closed response', async () => {
    const source = new PassThrough();
    const done = new Promise<void>((resolve) => {
      handler = (_req, res) => {
        res.destroy();
        pipeToResponse(source, res, 'Test');
        resolve();
      };
    });

    await get().catch(() => undefined);
    await done;
    expect(source.destroyed).toBe(true);
  });
});
