import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
  Mock,
} from 'vite-plus/test';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import EventEmitter from 'events';
import {
  startLocalServer,
  stopLocalServer,
  getServerPort,
  getServerAccessToken,
  authorizeSessionRequests,
  ACCESS_TOKEN_HEADER,
} from '../../src/main/local-server';
import { clearAuthCache } from '../../src/core/auth/security';
import { getMediaDirectories } from '../../src/core/database/database';
import { createTestMediaService } from '../utils/test-factory';

vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn(),
  getPendingTranscodeJobs: vi.fn().mockResolvedValue([]),
}));

const RENDERER_ORIGIN = 'http://localhost:5173';

interface Result {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

function request(
  port: number,
  requestPath: string,
  headers: http.OutgoingHttpHeaders,
  method = 'GET',
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: requestPath, headers, method },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Local server access control (F69)', () => {
  let root: string;
  let filePath: string;
  let port: number;
  let token: string;

  const fileUrl = () => `/${encodeURIComponent(filePath)}`;
  const validHeaders = (): http.OutgoingHttpHeaders => ({
    host: `127.0.0.1:${port}`,
    [ACCESS_TOKEN_HEADER]: token,
  });

  beforeAll(async () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'mediaplayer-access-')),
    );
    filePath = path.join(root, 'photo.txt');
    fs.writeFileSync(filePath, 'secret photo');
    (getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: root },
    ]);
    clearAuthCache();

    const { service } = createTestMediaService();
    port = await startLocalServer(root, service, {
      allowedOrigins: [RENDERER_ORIGIN],
    });
    token = getServerAccessToken();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => stopLocalServer(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('serves library files to requests carrying the token', async () => {
    const res = await request(port, fileUrl(), validHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toBe('secret photo');
  });

  it('accepts localhost as Host', async () => {
    const res = await request(port, fileUrl(), {
      ...validHeaders(),
      host: `localhost:${port}`,
    });
    expect(res.status).toBe(200);
  });

  it('rejects requests without the token', async () => {
    const res = await request(port, fileUrl(), { host: `127.0.0.1:${port}` });
    expect(res.status).toBe(403);
    expect(res.body).not.toContain('secret');
  });

  it('rejects requests with a wrong token', async () => {
    const res = await request(port, fileUrl(), {
      ...validHeaders(),
      [ACCESS_TOKEN_HEADER]: 'a'.repeat(token.length),
    });
    expect(res.status).toBe(403);
  });

  it('rejects metadata probes without the token', async () => {
    const res = await request(
      port,
      `/video/metadata?file=${encodeURIComponent('photo.txt')}`,
      { host: `127.0.0.1:${port}` },
    );
    expect(res.status).toBe(403);
  });

  it.each([
    [
      'a rebound domain on the right port',
      (p: number) => `attacker.example:${p}`,
    ],
    ['a domain without port', () => 'attacker.example'],
    ['another port', () => 'localhost:1'],
    ['loopback without port', () => '127.0.0.1'],
  ])('rejects a foreign Host header (DNS rebinding): %s', async (_, host) => {
    const res = await request(port, fileUrl(), {
      ...validHeaders(),
      host: host(port),
    });
    expect(res.status).toBe(403);
    expect(res.body).toBe('Invalid Host header');
  });

  it('allows CORS reads only from the renderer origin', async () => {
    const allowed = await request(port, fileUrl(), {
      ...validHeaders(),
      origin: RENDERER_ORIGIN,
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(
      RENDERER_ORIGIN,
    );

    const foreign = await request(port, fileUrl(), {
      ...validHeaders(),
      origin: 'https://attacker.example',
    });
    expect(foreign.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers CORS preflights without the token but serves no data', async () => {
    const res = await request(
      port,
      fileUrl(),
      {
        host: `127.0.0.1:${port}`,
        origin: RENDERER_ORIGIN,
        'access-control-request-method': 'GET',
      },
      'OPTIONS',
    );
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
  });

  it('adds the token to requests of an Electron session', async () => {
    const onBeforeSendHeaders = vi.fn();
    authorizeSessionRequests(
      { webRequest: { onBeforeSendHeaders } } as any,
      port,
    );

    const [filter, listener] = onBeforeSendHeaders.mock.calls[0];
    expect(filter).toEqual({
      urls: [`http://127.0.0.1:${port}/*`, `http://localhost:${port}/*`],
    });

    const callback = vi.fn();
    listener({ requestHeaders: { Accept: 'image/*' } }, callback);
    const { requestHeaders } = callback.mock.calls[0][0];
    expect(requestHeaders).toEqual({
      Accept: 'image/*',
      [ACCESS_TOKEN_HEADER]: token,
    });

    // The injected headers are accepted by the server.
    const res = await request(port, fileUrl(), {
      ...requestHeaders,
      host: `localhost:${port}`,
    });
    expect(res.status).toBe(200);
  });
});

describe('Local server start failures', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when the server cannot listen, and can start later', async () => {
    const failing: any = new EventEmitter();
    failing.listen = vi.fn(() => {
      process.nextTick(() => failing.emit('error', new Error('EACCES')));
    });
    const createServer = vi
      .spyOn(http, 'createServer')
      .mockReturnValueOnce(failing);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { service } = createTestMediaService();

    await expect(startLocalServer('/tmp', service)).rejects.toThrow('EACCES');
    expect(getServerPort()).toBe(0);

    createServer.mockRestore();
    const port = await startLocalServer('/tmp', service);
    expect(port).toBeGreaterThan(0);
    await new Promise<void>((resolve) => stopLocalServer(resolve));
  });
});
