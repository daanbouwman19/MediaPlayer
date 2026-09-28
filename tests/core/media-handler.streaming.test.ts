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
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { IMediaSource } from '../../src/core/media/media-source-types';

const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: mockSpawn,
    default: { ...actual, spawn: mockSpawn },
  };
});

// Authorization is not under test here: allow everything under the temp dir.
vi.mock('../../src/core/auth/access-utils', () => ({
  getAuthorizedPath: async (_res: unknown, filePath: string) => filePath,
}));
vi.mock('../../src/core/auth/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/auth/security')>();
  return {
    ...actual,
    authorizeFilePath: async (filePath: string) => ({
      isAllowed: true,
      realPath: filePath,
    }),
  };
});

import {
  generateFileUrl,
  handleStreamRequest,
  serveRawStream,
  serveStaticFile,
  serveTranscodedStream,
  resetTranscodeConcurrency,
} from '../../src/core/media/media-handler';
import { LocalMediaSource } from '../../src/core/media/media-source';

/**
 * Drives the handlers through a real Express server and real sockets, with
 * real files on disk, so response framing, aborts and sendFile behave as in
 * production.
 */

let dir: string;
let server: http.Server;
let baseUrl: string;
let currentSource: IMediaSource | null = null;
const VIDEO = Buffer.alloc(8192, 7);

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  complete: boolean;
}

function get(
  urlPath: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      `${baseUrl}${urlPath}`,
      { headers, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        const done = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            complete: res.complete,
          });
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', done);
        res.on('error', done);
        res.on('close', done);
      },
    );
    // Fail fast instead of hanging until the test timeout.
    req.setTimeout(3000, () => req.destroy(new Error('client timeout')));
    req.on('error', reject);
  });
}

/** Starts a request and aborts it once `until` resolves. */
function abortedGet(urlPath: string, until: () => Promise<unknown>) {
  const req = http.get(`${baseUrl}${urlPath}`, { agent: false });
  req.on('error', () => {});
  return until().then(() => {
    req.destroy();
    return new Promise((r) => setTimeout(r, 30));
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fakeFfmpeg() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.kill = vi.fn(() => {
    proc.stdout.end();
    proc.emit('exit', null, 'SIGKILL');
    return true;
  });
  return proc;
}

beforeAll(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'media-handler-'));
  // Linux Electron keeps its caches under ~/.config/<app>.
  await fsp.mkdir(path.join(dir, '.config', 'app'), { recursive: true });
  await fsp.writeFile(path.join(dir, '.config', 'app', 'video.mp4'), VIDEO);
  await fsp.writeFile(path.join(dir, 'video.mp4'), VIDEO);
  await fsp.writeFile(path.join(dir, 'empty.mp4'), '');
  await fsp.writeFile(
    path.join(dir, 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );

  const app = express();
  app.get('/stream', (req, res) => {
    void handleStreamRequest(req, res, '/usr/bin/ffmpeg');
  });
  app.get('/raw', (req, res) => {
    const source =
      currentSource ?? new LocalMediaSource(req.query.file as string);
    serveRawStream(req, res, source).catch((err: unknown) => {
      if (!res.headersSent) res.status(500).send(String(err));
    });
  });
  app.get('/transcode', (req, res) => {
    serveTranscodedStream(
      req,
      res,
      currentSource!,
      '/usr/bin/ffmpeg',
      undefined,
    ).catch((err: unknown) => {
      if (!res.headersSent) res.status(500).send(String(err));
    });
  });
  app.use((req, res) => {
    void serveStaticFile(req, res, decodeURIComponent(req.path.slice(1)));
  });

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fsp.rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  currentSource = null;
  resetTranscodeConcurrency();
  mockSpawn.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const q = (p: string) => encodeURIComponent(p);

describe('direct file serving (sendFile)', () => {
  it('serves a file under a dot-directory via /api/stream', async () => {
    // Regression (F05): send's default dotfiles:'ignore' made this a 404.
    const file = path.join(dir, '.config', 'app', 'video.mp4');
    const res = await get(`/stream?file=${q(file)}`);
    expect(res.status).toBe(200);
    expect(res.body.equals(VIDEO)).toBe(true);
  });

  it('serves a file under a dot-directory via the static fallback', async () => {
    const file = path.join(dir, '.config', 'app', 'video.mp4');
    const res = await get(`/${q(file)}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(VIDEO.length);
  });

  it('serves SVG with its registered type inside a CSP sandbox', async () => {
    const res = await get(`/stream?file=${q(path.join(dir, 'logo.svg'))}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });
});

describe('serveRawStream', () => {
  const raw = (file: string) => `/raw?file=${q(path.join(dir, file))}`;

  it('serves a full 200 without a Range header', async () => {
    const res = await get(raw('video.mp4'));
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(VIDEO.length));
    expect(res.headers['content-range']).toBeUndefined();
    expect(res.body.equals(VIDEO)).toBe(true);
  });

  it('serves a 206 for a bytes range', async () => {
    const res = await get(raw('video.mp4'), { Range: 'bytes=10-19' });
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 10-19/${VIDEO.length}`);
    expect(res.body.length).toBe(10);
  });

  it('serves an empty file as an empty 200', async () => {
    // Regression (F121): this used to be a 416.
    const res = await get(raw('empty.mp4'));
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('0');
    expect(res.body.length).toBe(0);
  });

  it.each([
    ['a unit other than bytes', 'items=0-5'],
    ['a malformed range', 'bytes=abc'],
  ])('ignores %s and serves a 200', async (_label, range) => {
    // Regression (F121): these used to be answered with a 206.
    const res = await get(raw('video.mp4'), { Range: range });
    expect(res.status).toBe(200);
    expect(res.headers['content-range']).toBeUndefined();
    expect(res.body.length).toBe(VIDEO.length);
  });

  it('serves SVG with its registered type inside a CSP sandbox', async () => {
    // Regression (F118): web mode served SVG as image/svg.
    const res = await get(raw('logo.svg'));
    expect(res.headers['content-type']).toBe('image/svg+xml');
    expect(res.headers['content-security-policy']).toContain('sandbox');
  });

  it('answers a stream that fails before its first byte with a clean 500', async () => {
    // Regression (F119): the 500 kept Content-Length: 8192 and the client
    // waited for bytes that never came.
    currentSource = {
      getSize: async () => VIDEO.length,
      getMimeType: async () => 'video/mp4',
      getFFmpegInput: async () => '',
      getStream: async () => ({
        stream: fs.createReadStream(path.join(dir, 'does-not-exist.mp4')),
        length: VIDEO.length,
      }),
    };

    const res = await get('/raw');
    expect(res.status).toBe(500);
    expect(res.headers['content-length']).not.toBe(String(VIDEO.length));
    expect(res.headers['content-range']).toBeUndefined();
    expect(res.complete).toBe(true);
  });

  it('destroys the stream of a client that aborted while it was being opened', async () => {
    // Regression (F28): the stream was piped into the dead response and
    // stayed open (a leaked fd; on Windows, a file lock).
    const opened = deferred<void>();
    const release = deferred<void>();
    const stream = fs.createReadStream(path.join(dir, 'video.mp4'));
    currentSource = {
      getSize: async () => VIDEO.length,
      getMimeType: async () => 'video/mp4',
      getFFmpegInput: async () => '',
      getStream: async () => {
        opened.resolve();
        await release.promise;
        return { stream, length: VIDEO.length };
      },
    };

    await abortedGet('/raw', () => opened.promise);
    release.resolve();

    await vi.waitFor(() => expect(stream.destroyed).toBe(true));
  });
});

describe('serveTranscodedStream', () => {
  function sourceWithInput(input: Promise<string>): IMediaSource {
    return {
      getSize: async () => 0,
      getMimeType: async () => 'video/mp4',
      getStream: async () => {
        throw new Error('unused');
      },
      getFFmpegInput: () => input,
    };
  }

  it('reserves its slot before awaiting the input', async () => {
    // Regression (F117): all concurrent requests passed the cap check while
    // their input lookups were pending.
    const input = deferred<string>();
    currentSource = sourceWithInput(input.promise);
    mockSpawn.mockImplementation(() => fakeFfmpeg());

    const first = get('/transcode');
    const second = get('/transcode');
    await new Promise((r) => setTimeout(r, 30));
    const third = await get('/transcode');

    expect(third.status).toBe(503);
    input.resolve('/in.mp4');
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(2));

    // Let the two transcodes finish.
    for (const [proc] of mockSpawn.mock.results.map((r) => [r.value])) {
      proc.stdout.end(Buffer.from('mp4'));
      proc.emit('exit', 0, null);
    }
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
  });

  it('releases the slot of a client that aborted before ffmpeg started', async () => {
    // Regression (F28): the slot was taken after the await and its release
    // was tied to a 'close' that had already fired.
    const input = deferred<string>();
    currentSource = sourceWithInput(input.promise);
    mockSpawn.mockImplementation(() => fakeFfmpeg());

    await abortedGet('/transcode', async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    await abortedGet('/transcode', async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    input.resolve('/in.mp4');
    await new Promise((r) => setTimeout(r, 30));

    // ffmpeg was never started for the departed clients...
    expect(mockSpawn).not.toHaveBeenCalled();
    // ...and both slots are free again.
    currentSource = sourceWithInput(Promise.resolve('/in.mp4'));
    const pending = get('/transcode');
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1));
    const proc = mockSpawn.mock.results[0]!.value;
    proc.stdout.end(Buffer.from('mp4'));
    proc.emit('exit', 0, null);
    expect((await pending).status).toBe(200);
  });

  it('kills ffmpeg when the client goes away mid-transcode', async () => {
    currentSource = sourceWithInput(Promise.resolve('/in.mp4'));
    const proc = fakeFfmpeg();
    mockSpawn.mockReturnValue(proc);

    await abortedGet('/transcode', async () => {
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
      proc.stdout.write(Buffer.alloc(1024));
    });

    await vi.waitFor(() => expect(proc.kill).toHaveBeenCalledWith('SIGKILL'));
  });

  it('spawns ffmpeg hidden and redacts proxy tokens from its stderr', async () => {
    const errors = vi.mocked(console.error);
    currentSource = sourceWithInput(
      Promise.resolve('http://127.0.0.1:1/stream/abc?token=deadbeef'),
    );
    const proc = fakeFfmpeg();
    mockSpawn.mockReturnValue(proc);

    const pending = get('/transcode');
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    expect(mockSpawn.mock.calls[0]![2]).toMatchObject({ windowsHide: true });

    proc.stderr.write(
      'http://127.0.0.1:1/stream/abc?token=deadbeef: Server returned 403\n',
    );
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith(
        expect.stringContaining('token=[redacted]'),
      ),
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain('deadbeef');

    proc.stdout.end();
    proc.emit('exit', 0, null);
    await pending;
  });

  it('answers a spawn failure with a 500', async () => {
    currentSource = sourceWithInput(Promise.resolve('/in.mp4'));
    const proc = fakeFfmpeg();
    mockSpawn.mockReturnValue(proc);

    const pending = get('/transcode');
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    proc.emit(
      'error',
      Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }),
    );
    proc.stdout.end();

    expect((await pending).status).toBe(500);
  });
});

describe('generateFileUrl', () => {
  it('builds a data URL for a local file whose name contains an ellipsis', async () => {
    // Regression (F101): '..' anywhere in the name was rejected as traversal,
    // so the ambient background failed for such files.
    const file = path.join(dir, 'Holiday...2023.jpg');
    await fsp.writeFile(file, 'jpeg-bytes');

    const result = await generateFileUrl(file, { serverPort: 0 });

    expect(result).toEqual({
      type: 'data-url',
      url: `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`,
    });
  });

  it('builds an SVG data URL with the registered MIME type', async () => {
    // Regression (F118): Electron data URLs used image/svg.
    const result = await generateFileUrl(path.join(dir, 'logo.svg'), {
      serverPort: 0,
    });
    expect(result.url).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
