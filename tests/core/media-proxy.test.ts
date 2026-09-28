// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'vite-plus/test';
import http from 'http';
import { PassThrough, Readable } from 'stream';
import {
  InternalMediaProxy,
  redactProxyTokens,
} from '../../src/core/media/media-proxy';
import {
  registerDriveBackend,
  resetDriveBackend,
  type DriveBackend,
} from '../../src/core/media/drive-backend';

const { mockIsFileInLibrary } = vi.hoisted(() => ({
  mockIsFileInLibrary: vi.fn(),
}));

vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: mockIsFileInLibrary,
}));

/**
 * The proxy runs as a real loopback HTTP server, on top of the real
 * drive-stream, with only the Drive API itself faked: it serves byte ranges
 * of an in-memory file.
 */
const TOTAL = 4096;
const REMOTE = Buffer.alloc(TOTAL);
for (let i = 0; i < TOTAL; i++) REMOTE[i] = i % 251;

let backend: {
  getFileMetadata: ReturnType<typeof vi.fn>;
  getFileStream: ReturnType<typeof vi.fn>;
  listFolder: ReturnType<typeof vi.fn>;
  setCredentials: ReturnType<typeof vi.fn>;
  getCachedFile: ReturnType<typeof vi.fn>;
};

interface ProxyResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  complete: boolean;
}

function get(
  url: string,
  headers: Record<string, string> = {},
): Promise<ProxyResponse> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      const done = () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
          complete: res.complete,
        });
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', done);
      res.on('error', done);
      res.on('close', done);
    });
    req.on('error', reject);
  });
}

function withToken(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set('token', token);
  return u.toString();
}

const proxy = InternalMediaProxy.getInstance();

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mockIsFileInLibrary.mockReset().mockResolvedValue(true);
  backend = {
    getFileMetadata: vi.fn(async (id: string) => ({
      id,
      name: `${id}.mp4`,
      size: String(TOTAL),
      mimeType: 'video/mp4',
    })),
    getFileStream: vi.fn(
      async (_id: string, range?: { start?: number; end?: number }) =>
        Readable.from([
          REMOTE.subarray(range?.start ?? 0, (range?.end ?? TOTAL - 1) + 1),
        ]),
    ),
    listFolder: vi.fn(),
    setCredentials: vi.fn(),
    // No local cache: every byte comes from "Drive".
    getCachedFile: vi.fn().mockRejectedValue(new Error('no cache')),
  };
  resetDriveBackend();
  registerDriveBackend(backend as unknown as DriveBackend);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  const server = (proxy as unknown as { server: http.Server }).server;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('InternalMediaProxy', () => {
  it('getInstance returns a singleton', () => {
    expect(InternalMediaProxy.getInstance()).toBe(proxy);
  });

  it('starts once, even for concurrent callers', async () => {
    await Promise.all([proxy.start(), proxy.start(), proxy.getUrlForFile('a')]);
    expect(proxy.getPort()).toBeGreaterThan(0);
  });

  describe('getUrlForFile', () => {
    it('returns a loopback URL for the file with a token', async () => {
      const url = new URL(await proxy.getUrlForFile('file1', '.mp4'));
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.pathname).toBe('/stream/file1.mp4');
      expect(url.searchParams.get('token')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('mints a new token for every URL', async () => {
      const a = new URL(await proxy.getUrlForFile('file1'));
      const b = new URL(await proxy.getUrlForFile('file1'));
      expect(a.searchParams.get('token')).not.toBe(b.searchParams.get('token'));
    });

    it.each(['.mp4?x', '.m#4', '. 2', '.toolong', 'mp4'])(
      'drops an unsafe extension %j',
      async (ext) => {
        const url = new URL(await proxy.getUrlForFile('file1', ext));
        expect(url.pathname).toBe('/stream/file1');
        expect(url.searchParams.get('token')).toMatch(/^[0-9a-f]{64}$/);
      },
    );

    it('rejects an invalid Drive file ID', async () => {
      await expect(proxy.getUrlForFile('a/../b')).rejects.toThrow(
        'Invalid Drive file ID',
      );
      await expect(proxy.getUrlForFile('a?b')).rejects.toThrow(
        'Invalid Drive file ID',
      );
    });
  });

  describe('request handling', () => {
    it('rejects a request without a token', async () => {
      const url = new URL(await proxy.getUrlForFile('file1'));
      url.search = '';
      const res = await get(url.toString());
      expect(res.status).toBe(403);
      expect(res.body.toString()).toBe('Access denied');
    });

    it('rejects an unknown token', async () => {
      const url = withToken(await proxy.getUrlForFile('file1'), 'f'.repeat(64));
      expect((await get(url)).status).toBe(403);
    });

    it('rejects a token minted for a different file', async () => {
      // A leaked URL must not unlock the rest of the library.
      const url = new URL(await proxy.getUrlForFile('file1'));
      url.pathname = '/stream/other-file';
      const res = await get(url.toString());
      expect(res.status).toBe(403);
      expect(backend.getFileMetadata).not.toHaveBeenCalled();
    });

    it('returns 404 for an unknown path with a valid token', async () => {
      const url = new URL(await proxy.getUrlForFile('file1'));
      url.pathname = '/invalid';
      expect((await get(url.toString())).status).toBe(404);
    });

    it('blocks a file that is not in the library (IDOR prevention)', async () => {
      mockIsFileInLibrary.mockResolvedValue(false);
      const res = await get(await proxy.getUrlForFile('not-in-lib'));
      expect(res.status).toBe(403);
      expect(mockIsFileInLibrary).toHaveBeenCalledWith('gdrive://not-in-lib');
      expect(backend.getFileStream).not.toHaveBeenCalled();
    });

    it('serves the whole file as a 200 without a Range header', async () => {
      const res = await get(await proxy.getUrlForFile('file1', '.mp4'));
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('video/mp4');
      expect(res.headers['content-length']).toBe(String(TOTAL));
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-range']).toBeUndefined();
      expect(res.body.equals(REMOTE)).toBe(true);
    });

    it('serves a byte range as a 206', async () => {
      const res = await get(await proxy.getUrlForFile('file1'), {
        Range: 'bytes=100-199',
      });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(`bytes 100-199/${TOTAL}`);
      expect(res.headers['content-length']).toBe('100');
      expect(res.body.equals(REMOTE.subarray(100, 200))).toBe(true);
    });

    it('serves an open-ended range', async () => {
      const res = await get(await proxy.getUrlForFile('file1'), {
        Range: 'bytes=4000-',
      });
      expect(res.status).toBe(206);
      expect(res.headers['content-range']).toBe(
        `bytes 4000-${TOTAL - 1}/${TOTAL}`,
      );
      expect(res.body.equals(REMOTE.subarray(4000))).toBe(true);
    });

    it('answers an unsatisfiable range with 416', async () => {
      const res = await get(await proxy.getUrlForFile('file1'), {
        Range: `bytes=${TOTAL}-`,
      });
      expect(res.status).toBe(416);
      expect(res.headers['content-range']).toBe(`bytes */${TOTAL}`);
    });

    it('ignores a malformed Range header and serves a 200', async () => {
      const res = await get(await proxy.getUrlForFile('file1'), {
        Range: 'invalid-unit=0-100',
      });
      expect(res.status).toBe(200);
      expect(res.body.equals(REMOTE)).toBe(true);
    });

    it('answers a metadata failure with a 500', async () => {
      backend.getFileMetadata.mockRejectedValue(new Error('API Fail'));
      const res = await get(await proxy.getUrlForFile('file1'));
      expect(res.status).toBe(500);
    });

    it('reuses cached metadata across requests', async () => {
      const url = await proxy.getUrlForFile('cached-meta');
      await get(url, { Range: 'bytes=0-9' });
      await get(url, { Range: 'bytes=10-19' });
      await get(url, { Range: 'bytes=20-29' });
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(1);
    });

    it('answers a Drive failure before the first byte with a clean 500', async () => {
      backend.getFileStream.mockRejectedValue(new Error('403 from Drive'));
      const res = await get(await proxy.getUrlForFile('file1'));
      expect(res.status).toBe(500);
      // No stale Content-Length/Content-Range for a body that never comes.
      expect(res.headers['content-length']).not.toBe(String(TOTAL));
      expect(res.headers['content-range']).toBeUndefined();
      expect(res.body.length).toBe(0);
      expect(res.complete).toBe(true);
    });

    it('terminates the response when Drive fails mid-stream', async () => {
      // Regression (F29): the response used to stay open forever, so ffmpeg
      // blocked on its input.
      const drive = new PassThrough();
      backend.getFileStream.mockResolvedValue(drive);
      const pending = get(await proxy.getUrlForFile('file1'));
      await vi.waitFor(() => expect(backend.getFileStream).toHaveBeenCalled());
      drive.write(REMOTE.subarray(0, 100));
      await new Promise((r) => setTimeout(r, 20));
      drive.destroy(new Error('ECONNRESET from Google'));

      const res = await pending;
      expect(res.status).toBe(200);
      expect(res.complete).toBe(false);
    });

    it('destroys the Drive download when the client disconnects', async () => {
      const drive = new PassThrough();
      backend.getFileStream.mockResolvedValue(drive);
      const url = await proxy.getUrlForFile('file1');

      await new Promise<void>((resolve) => {
        const req = http.get(url, { agent: false }, (res) => {
          res.once('data', () => {
            req.destroy();
            resolve();
          });
        });
        req.on('error', () => {});
        void vi
          .waitFor(() => expect(backend.getFileStream).toHaveBeenCalled())
          .then(() => drive.write(REMOTE.subarray(0, 100)));
      });

      await vi.waitFor(() => expect(drive.destroyed).toBe(true));
    });

    it('never opens Drive for a client that left during the metadata lookup', async () => {
      let resolveMeta!: (meta: object) => void;
      backend.getFileMetadata.mockReturnValue(
        new Promise((resolve) => {
          resolveMeta = resolve;
        }),
      );
      const url = await proxy.getUrlForFile('slow-meta');

      const req = http.get(url, { agent: false });
      req.on('error', () => {});
      await vi.waitFor(() =>
        expect(backend.getFileMetadata).toHaveBeenCalled(),
      );
      req.destroy();
      await new Promise((r) => setTimeout(r, 20));
      resolveMeta({ id: 'slow-meta', size: String(TOTAL) });
      await new Promise((r) => setTimeout(r, 20));

      expect(backend.getFileStream).not.toHaveBeenCalled();
    });
  });

  describe('token lifetime', () => {
    it('expires a token that has not been used for a while', async () => {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      const url = await proxy.getUrlForFile('file1');

      expect((await get(url, { Range: 'bytes=0-9' })).status).toBe(206);

      clock.mockReturnValue(now + 4 * 60 * 1000);
      expect((await get(url, { Range: 'bytes=0-9' })).status).toBe(206);

      clock.mockReturnValue(now + 10 * 60 * 1000);
      expect((await get(url, { Range: 'bytes=0-9' })).status).toBe(403);
    });

    it('keeps a token alive while one of its requests is streaming', async () => {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      const drive = new PassThrough();
      backend.getFileStream.mockResolvedValueOnce(drive);
      const url = await proxy.getUrlForFile('file1');

      // A long-running read (e.g. an HLS transcode) holds the token.
      const longRead = get(url);
      await vi.waitFor(() => expect(backend.getFileStream).toHaveBeenCalled());

      clock.mockReturnValue(now + 60 * 60 * 1000);
      // ffmpeg seeks: a second request with the same URL is still accepted.
      expect((await get(url, { Range: 'bytes=0-9' })).status).toBe(206);

      drive.end(REMOTE);
      expect((await longRead).status).toBe(200);
    });
  });
});

describe('redactProxyTokens', () => {
  it('masks the token in an ffmpeg error line', () => {
    const line =
      'http://127.0.0.1:5000/stream/abc.mp4?token=0123abcd: Server returned 403 Forbidden';
    expect(redactProxyTokens(line)).toBe(
      'http://127.0.0.1:5000/stream/abc.mp4?token=[redacted]: Server returned 403 Forbidden',
    );
  });

  it('leaves text without a token untouched', () => {
    expect(redactProxyTokens('frame=  10 fps=0.0 q=0.0')).toBe(
      'frame=  10 fps=0.0 q=0.0',
    );
  });
});
