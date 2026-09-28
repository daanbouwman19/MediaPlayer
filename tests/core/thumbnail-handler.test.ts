import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  serveThumbnail,
  generateLocalThumbnail,
  resetThumbnailState,
} from '../../src/core/media/thumbnail-handler';
import { getThumbnailCachePath } from '../../src/core/media/media-utils';

const {
  mockRunFFmpeg,
  mockValidateFileAccess,
  mockHandleAccessCheck,
  mockGetThumbnailStream,
} = vi.hoisted(() => ({
  mockRunFFmpeg: vi.fn(),
  mockValidateFileAccess: vi.fn(),
  mockHandleAccessCheck: vi.fn(),
  mockGetThumbnailStream: vi.fn(),
}));

vi.mock('../../src/core/auth/access-validator', () => ({
  validateFileAccess: mockValidateFileAccess,
  handleAccessCheck: mockHandleAccessCheck,
}));

vi.mock('../../src/infrastructure/ffmpeg-utils', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../src/infrastructure/ffmpeg-utils')
    >();
  return { ...actual, runFFmpeg: mockRunFFmpeg };
});

vi.mock('../../src/infrastructure/fs-provider-factory', () => ({
  getProvider: () => ({ getThumbnailStream: mockGetThumbnailStream }),
}));

const inputOf = (args: string[]) => args[args.indexOf('-i') + 1];
const outputOf = (args: string[]) => args[args.length - 1];
const seekOf = (args: string[]) =>
  args.includes('-ss') ? Number(args[args.indexOf('-ss') + 1]) : 0;

/** FFmpeg stand-in that writes a fake JPEG naming the input and seek. */
const writeThumbnail = async (_cmd: string, args: string[]) => {
  fs.writeFileSync(
    outputOf(args),
    `jpeg:${path.basename(inputOf(args))}@${seekOf(args)}`,
  );
  return { code: 0, stdout: '', stderr: '' };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Minimal Express response: sendFile serves real files from disk. */
function createRes() {
  const res: any = new EventEmitter();
  res.headersSent = false;
  res.writableFinished = false;
  res.served = null as string | null;
  const finish = () => {
    res.headersSent = true;
    res.writableFinished = true;
    return res;
  };
  res.status = vi.fn(() => res);
  res.set = vi.fn(() => res);
  res.send = vi.fn(finish);
  res.end = vi.fn(finish);
  res.sendFile = vi.fn(
    (file: string, _options: unknown, cb: (err: unknown) => void) => {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.served = fs.readFileSync(file, 'utf8');
        finish();
        cb(null);
      } else {
        cb(Object.assign(new Error('ENOENT'), { code: 'ENOENT', status: 404 }));
      }
    },
  );
  return res;
}

describe('thumbnail-handler', () => {
  let tmp: string;
  let mediaDir: string;
  let cacheDir: string;

  const createMedia = (name: string, content = 'media-bytes') => {
    const file = path.join(mediaDir, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const cacheEntries = () => fs.readdirSync(cacheDir).sort();

  beforeEach(() => {
    vi.clearAllMocks();
    resetThumbnailState();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumbs-'));
    mediaDir = path.join(tmp, 'media');
    // Electron keeps its caches under ~/.config on Linux.
    cacheDir = path.join(tmp, '.config', 'thumbnails');
    fs.mkdirSync(mediaDir);
    fs.mkdirSync(cacheDir, { recursive: true });

    mockValidateFileAccess.mockImplementation(async (filePath: string) => ({
      success: true,
      path: filePath,
    }));
    mockHandleAccessCheck.mockImplementation(
      (res: any, access: { success: boolean }) => {
        if (access.success) return false;
        res.status(403).send('Access denied.');
        return true;
      },
    );
    mockRunFFmpeg.mockImplementation(writeThumbnail);
  });

  afterEach(() => {
    resetThumbnailState();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('local files', () => {
    it('generates a downscaled thumbnail at 1 s, then serves the cached copy', async () => {
      const video = createMedia('clip.mp4');

      const res = createRes();
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);

      expect(mockRunFFmpeg).toHaveBeenCalledTimes(1);
      const args: string[] = mockRunFFmpeg.mock.calls[0][1];
      expect(seekOf(args)).toBe(1);
      expect(args).toContain('-vf');
      expect(res.served).toBe('jpeg:clip.mp4@1');
      expect(res.sendFile).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          dotfiles: 'allow',
          headers: expect.objectContaining({
            'Content-Type': 'image/jpeg',
            'Cache-Control': expect.stringContaining('max-age=86400'),
          }),
        }),
        expect.any(Function),
      );
      // Only the finished thumbnail is left; the temp file was renamed.
      expect(cacheEntries()).toEqual([
        path.basename(res.sendFile.mock.lastCall[0]),
      ]);

      const again = createRes();
      await serveThumbnail({}, again, video, 'ffmpeg', cacheDir);
      expect(again.served).toBe('jpeg:clip.mp4@1');
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(1);
    });

    it('falls back to the first frame for clips shorter than the seek position', async () => {
      const video = createMedia('short.mp4');
      mockRunFFmpeg.mockImplementation(async (cmd: string, args: string[]) => {
        // FFmpeg exits 0 without output when seeking past the end.
        if (seekOf(args) > 0) return { code: 0, stdout: '', stderr: '' };
        return writeThumbnail(cmd, args);
      });

      const res = createRes();
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);

      expect(mockRunFFmpeg).toHaveBeenCalledTimes(2);
      expect(mockRunFFmpeg.mock.calls[1][1]).not.toContain('-ss');
      expect(res.served).toBe('jpeg:short.mp4@0');
    });

    it('does not seek into images', async () => {
      const image = createMedia('photo.JPG');

      const res = createRes();
      await serveThumbnail({}, res, image, 'ffmpeg', cacheDir);

      expect(mockRunFFmpeg).toHaveBeenCalledTimes(1);
      expect(mockRunFFmpeg.mock.calls[0][1]).not.toContain('-ss');
      expect(res.served).toBe('jpeg:photo.JPG@0');
    });

    it('remembers a generation that produced nothing instead of re-running ffmpeg on every view', async () => {
      const broken = createMedia('broken.mp4');
      mockRunFFmpeg.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

      const res = createRes();
      await serveThumbnail({}, res, broken, 'ffmpeg', cacheDir);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Generation failed');
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(2); // seek 1, then seek 0
      expect(cacheEntries()).toEqual([]);

      const again = createRes();
      await serveThumbnail({}, again, broken, 'ffmpeg', cacheDir);
      expect(again.status).toHaveBeenCalledWith(500);
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(2);
    });

    it('returns 500 and remembers a non-zero FFmpeg exit', async () => {
      const video = createMedia('bad.mp4');
      mockRunFFmpeg.mockResolvedValue({ code: 1, stdout: '', stderr: 'Error' });

      const res = createRes();
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Generation failed');

      await serveThumbnail({}, createRes(), video, 'ffmpeg', cacheDir);
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(1);
    });

    it('retries a remembered failure once it expires', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const video = createMedia('flaky.mp4');
        mockRunFFmpeg.mockResolvedValueOnce({
          code: 1,
          stdout: '',
          stderr: '',
        });
        await serveThumbnail({}, createRes(), video, 'ffmpeg', cacheDir);

        vi.setSystemTime(Date.now() + 61 * 60 * 1000);
        const res = createRes();
        await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);
        expect(mockRunFFmpeg).toHaveBeenCalledTimes(2);
        expect(res.served).toBe('jpeg:flaky.mp4@1');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the thumbnail already in place if the final rename is refused', async () => {
      const video = createMedia('locked.mp4');
      const identity = `${fs.statSync(video).size}-${Math.floor(fs.statSync(video).mtimeMs)}`;
      const cacheFile = getThumbnailCachePath(video, cacheDir, identity);
      const refused = Object.assign(new Error('EPERM'), { code: 'EPERM' });
      const rename = vi
        .spyOn(fs.promises, 'rename')
        .mockImplementationOnce(async () => {
          // Another writer finished first, then Windows refused the replace.
          fs.writeFileSync(cacheFile, 'jpeg:other-writer');
          throw refused;
        })
        .mockRejectedValueOnce(refused);

      const res = createRes();
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);
      expect(res.served).toBe('jpeg:other-writer');

      // Without a complete copy in place the failure is reported.
      fs.rmSync(cacheFile);
      resetThumbnailState();
      const failed = createRes();
      await serveThumbnail({}, failed, video, 'ffmpeg', cacheDir);
      expect(failed.status).toHaveBeenCalledWith(500);
      rename.mockRestore();
    });

    it('sweeps expired thumbnails and stale temp files from the cache', async () => {
      const age = (file: string, ms: number) => {
        const time = new Date(Date.now() - ms);
        fs.utimesSync(file, time, time);
      };
      const hex = 'a'.repeat(32);
      const old = path.join(cacheDir, `${hex}.jpg`);
      const fresh = path.join(cacheDir, `${'b'.repeat(32)}.jpg`);
      const temp = path.join(
        cacheDir,
        `${hex}.jpg.0f0e0d0c-0b0a-4908-8706-050403020100.tmp.jpg`,
      );
      const heatmap = path.join(cacheDir, `heatmap_v2_${'c'.repeat(64)}.json`);
      for (const file of [old, fresh, temp, heatmap])
        fs.writeFileSync(file, 'x');
      age(old, 100 * 24 * 60 * 60 * 1000);
      age(temp, 2 * 60 * 60 * 1000);
      age(heatmap, 100 * 24 * 60 * 60 * 1000);

      vi.useFakeTimers({ toFake: ['setTimeout'] });
      try {
        await serveThumbnail(
          {},
          createRes(),
          createMedia('c.mp4'),
          'ffmpeg',
          cacheDir,
        );
        await vi.advanceTimersByTimeAsync(60 * 1000);
      } finally {
        vi.useRealTimers();
      }

      await vi.waitFor(() => expect(fs.existsSync(old)).toBe(false));
      await vi.waitFor(() => expect(fs.existsSync(temp)).toBe(false));
      expect(fs.existsSync(fresh)).toBe(true);
      // Heatmaps in a shared cache dir belong to the analyzer's own sweep.
      expect(fs.existsSync(heatmap)).toBe(true);
    });

    it('returns 500 when FFmpeg times out', async () => {
      const video = createMedia('slow.mp4');
      mockRunFFmpeg.mockRejectedValue(new Error('Process timed out'));

      const res = createRes();
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Generation failed');
    });

    it('regenerates the thumbnail when the file is replaced', async () => {
      const video = createMedia('Trip.mp4', 'first export');
      const first = createRes();
      await serveThumbnail({}, first, video, 'ffmpeg', cacheDir);

      fs.writeFileSync(video, 'second export, longer');
      const later = new Date(Date.now() + 60_000);
      fs.utimesSync(video, later, later);

      const second = createRes();
      await serveThumbnail({}, second, video, 'ffmpeg', cacheDir);
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(2);
      expect(second.sendFile.mock.lastCall[0]).not.toBe(
        first.sendFile.mock.lastCall[0],
      );
    });

    it('shares one FFmpeg run between concurrent requests for the same file', async () => {
      const video = createMedia('popular.mp4');
      const gate = deferred<void>();
      mockRunFFmpeg.mockImplementation(async (cmd: string, args: string[]) => {
        await gate.promise;
        return writeThumbnail(cmd, args);
      });

      const a = createRes();
      const b = createRes();
      const pa = serveThumbnail({}, a, video, 'ffmpeg', cacheDir);
      const pb = serveThumbnail({}, b, video, 'ffmpeg', cacheDir);
      await vi.waitFor(() => expect(mockRunFFmpeg).toHaveBeenCalled());

      // While FFmpeg runs, only a temp file exists: nobody can read a partial thumbnail.
      const output = outputOf(mockRunFFmpeg.mock.calls[0][1]);
      expect(output).toMatch(/\.tmp\.jpg$/);

      gate.resolve();
      await Promise.all([pa, pb]);
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(1);
      expect(a.served).toBe('jpeg:popular.mp4@1');
      expect(b.served).toBe('jpeg:popular.mp4@1');
    });

    it('drops queued work when its client disconnects', async () => {
      const gates = [deferred<void>(), deferred<void>()];
      mockRunFFmpeg.mockImplementation(async (cmd: string, args: string[]) => {
        await gates[mockRunFFmpeg.mock.calls.length - 1]?.promise;
        return writeThumbnail(cmd, args);
      });
      // Two jobs fill the queue (concurrency 2); the third waits.
      const busyA = serveThumbnail(
        {},
        createRes(),
        createMedia('a.mp4'),
        'ffmpeg',
        cacheDir,
      );
      const busyB = serveThumbnail(
        {},
        createRes(),
        createMedia('b.mp4'),
        'ffmpeg',
        cacheDir,
      );
      await vi.waitFor(() => expect(mockRunFFmpeg).toHaveBeenCalledTimes(2));

      const leaving = createRes();
      const pending = serveThumbnail(
        {},
        leaving,
        createMedia('scrolled-away.mp4'),
        'ffmpeg',
        cacheDir,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      leaving.emit('close');
      await pending;

      gates[0].resolve();
      gates[1].resolve();
      await Promise.all([busyA, busyB]);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockRunFFmpeg).toHaveBeenCalledTimes(2);
      expect(leaving.sendFile).toHaveBeenCalledTimes(1); // only the cache probe
      expect(leaving.status).not.toHaveBeenCalled();
    });

    it('kills a running FFmpeg when its only client disconnects, without remembering a failure', async () => {
      const video = createMedia('abandoned.mp4');
      let seenSignal: AbortSignal | undefined;
      mockRunFFmpeg.mockImplementation(
        (
          _cmd: string,
          _args: string[],
          _timeout: unknown,
          signal: AbortSignal,
        ) => {
          seenSignal = signal;
          return new Promise((resolve) => {
            signal.addEventListener('abort', () =>
              resolve({ code: null, stdout: '', stderr: '' }),
            );
          });
        },
      );

      const res = createRes();
      const pending = serveThumbnail({}, res, video, 'ffmpeg', cacheDir);
      await vi.waitFor(() => expect(seenSignal).toBeDefined());
      res.emit('close');
      await pending;

      expect(seenSignal?.aborted).toBe(true);
      expect(res.status).not.toHaveBeenCalled();

      // The next viewer gets a fresh attempt.
      mockRunFFmpeg.mockImplementation(writeThumbnail);
      const next = createRes();
      await serveThumbnail({}, next, video, 'ffmpeg', cacheDir);
      expect(next.served).toBe('jpeg:abandoned.mp4@1');
    });

    it('keeps generating while another client still waits', async () => {
      const video = createMedia('shared.mp4');
      const gate = deferred<void>();
      let seenSignal: AbortSignal | undefined;
      mockRunFFmpeg.mockImplementation(
        async (
          cmd: string,
          args: string[],
          _t: unknown,
          signal: AbortSignal,
        ) => {
          seenSignal = signal;
          await gate.promise;
          return writeThumbnail(cmd, args);
        },
      );

      const leaving = createRes();
      const staying = createRes();
      const p1 = serveThumbnail({}, leaving, video, 'ffmpeg', cacheDir);
      const p2 = serveThumbnail({}, staying, video, 'ffmpeg', cacheDir);
      await vi.waitFor(() => expect(seenSignal).toBeDefined());

      leaving.emit('close');
      await p1;
      expect(seenSignal?.aborted).toBe(false);

      gate.resolve();
      await p2;
      expect(staying.served).toBe('jpeg:shared.mp4@1');
    });

    it('returns 500 if the ffmpeg binary is not found', async () => {
      const res = createRes();
      await serveThumbnail({}, res, createMedia('x.mp4'), null, cacheDir);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('FFmpeg binary not found');
    });

    it('returns 500 if sending the generated file fails', async () => {
      const res = createRes();
      const serveFromDisk = res.sendFile.getMockImplementation();
      res.sendFile
        .mockImplementationOnce(serveFromDisk) // cache probe: miss
        .mockImplementationOnce(
          (_f: string, _o: unknown, cb: (err: unknown) => void) =>
            cb(new Error('Stream error')),
        );

      await serveThumbnail({}, res, createMedia('y.mp4'), 'ffmpeg', cacheDir);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.end).toHaveBeenCalled();
    });

    it('treats an error after headers were sent as handled', async () => {
      const video = createMedia('z.mp4');
      await serveThumbnail({}, createRes(), video, 'ffmpeg', cacheDir);

      const res = createRes();
      res.sendFile.mockImplementationOnce(
        (_f: string, _o: unknown, cb: (err: unknown) => void) => {
          res.headersSent = true;
          cb(new Error('ECONNABORTED'));
        },
      );
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);
      expect(res.sendFile).toHaveBeenCalledTimes(1);
      expect(mockRunFFmpeg).toHaveBeenCalledTimes(1);
    });
  });

  describe('access control', () => {
    it('blocks unauthorized files even if a thumbnail is cached', async () => {
      const video = createMedia('secret.mp4');
      fs.writeFileSync(getThumbnailCachePath(video, cacheDir), 'cached');
      mockValidateFileAccess.mockResolvedValue({ success: false });

      const res = createRes();
      await serveThumbnail({}, res, video, 'ffmpeg', cacheDir);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('generateLocalThumbnail re-validates access', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      const res = createRes();
      await generateLocalThumbnail(res, '/denied.mp4', '/cache.jpg', 'ffmpeg');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockRunFFmpeg).not.toHaveBeenCalled();
    });
  });

  describe('Drive files', () => {
    const drivePath = 'gdrive://file-1';
    const driveCache = () => getThumbnailCachePath(drivePath, cacheDir);

    it('downloads through a temp file, caches it and serves the copy', async () => {
      mockGetThumbnailStream.mockResolvedValue(
        Readable.from([Buffer.from('drive-'), Buffer.from('jpeg')]),
      );

      const res = createRes();
      await serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);
      expect(res.served).toBe('drive-jpeg');
      expect(mockGetThumbnailStream).toHaveBeenCalledWith(drivePath);
      expect(cacheEntries()).toEqual([path.basename(driveCache())]);

      const again = createRes();
      await serveThumbnail({}, again, drivePath, 'ffmpeg', cacheDir);
      expect(again.served).toBe('drive-jpeg');
      expect(mockGetThumbnailStream).toHaveBeenCalledTimes(1);
      expect(mockRunFFmpeg).not.toHaveBeenCalled();
    });

    it('survives a stream error mid-download without caching a truncated file', async () => {
      mockGetThumbnailStream.mockResolvedValue(
        new Readable({
          read() {
            this.push('partial-');
            this.destroy(new Error('ECONNRESET'));
          },
        }),
      );

      const res = createRes();
      await serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalled();
      expect(cacheEntries()).toEqual([]);
    });

    it('survives a cache write error', async () => {
      mockGetThumbnailStream.mockResolvedValue(Readable.from(['jpeg']));
      const missingDir = path.join(cacheDir, 'does-not-exist');

      const res = createRes();
      await serveThumbnail({}, res, drivePath, 'ffmpeg', missingDir);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('returns 404 and briefly remembers a Drive file without a thumbnail', async () => {
      mockGetThumbnailStream.mockResolvedValue(null);

      const res = createRes();
      await serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);
      expect(res.status).toHaveBeenCalledWith(404);

      await serveThumbnail({}, createRes(), drivePath, 'ffmpeg', cacheDir);
      expect(mockGetThumbnailStream).toHaveBeenCalledTimes(1);
      // Drive files never fall through to local FFmpeg.
      expect(mockRunFFmpeg).not.toHaveBeenCalled();
    });

    it('does not cache an empty Drive thumbnail', async () => {
      mockGetThumbnailStream.mockResolvedValue(Readable.from([]));

      const res = createRes();
      await serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);
      expect(res.status).toHaveBeenCalledWith(404);
      expect(cacheEntries()).toEqual([]);
    });

    it('refreshes an old Drive thumbnail, and serves the old one if Drive fails', async () => {
      fs.writeFileSync(driveCache(), 'old-jpeg');
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      fs.utimesSync(driveCache(), eightDaysAgo, eightDaysAgo);
      mockGetThumbnailStream.mockRejectedValue(new Error('offline'));

      const res = createRes();
      await serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);
      expect(mockGetThumbnailStream).toHaveBeenCalledTimes(1);
      expect(res.served).toBe('old-jpeg');

      resetThumbnailState();
      mockGetThumbnailStream.mockResolvedValue(Readable.from(['new-jpeg']));
      const refreshed = createRes();
      await serveThumbnail({}, refreshed, drivePath, 'ffmpeg', cacheDir);
      expect(refreshed.served).toBe('new-jpeg');
    });

    it('gives up on a hanging Drive request and destroys a late stream', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        let deliver!: (stream: Readable) => void;
        mockGetThumbnailStream.mockReturnValue(
          new Promise<Readable>((resolve) => {
            deliver = resolve;
          }),
        );

        const res = createRes();
        const pending = serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);
        await vi.waitFor(() =>
          expect(mockGetThumbnailStream).toHaveBeenCalled(),
        );
        await vi.advanceTimersByTimeAsync(20_000);
        await pending;
        expect(res.status).toHaveBeenCalledWith(404);

        const late = Readable.from(['late']);
        deliver(late);
        await vi.waitFor(() => expect(late.destroyed).toBe(true));
      } finally {
        vi.useRealTimers();
      }
    });

    it('starts a fresh download for a tile that remounts while the abandoned one is still tearing down', async () => {
      // A download whose connection takes a while to close once destroyed.
      const teardown = deferred<void>();
      const abandonedStream = new Readable({
        read() {},
        destroy(err, callback) {
          void teardown.promise.then(() => callback(err));
        },
      });
      abandonedStream.push('partial-');
      mockGetThumbnailStream
        .mockResolvedValueOnce(abandonedStream)
        .mockImplementation(async () => Readable.from(['drive-jpeg']));

      const leaving = createRes();
      const abandoned = serveThumbnail(
        {},
        leaving,
        drivePath,
        'ffmpeg',
        cacheDir,
      );
      await vi.waitFor(() =>
        expect(fs.readdirSync(cacheDir).length).toBeGreaterThan(0),
      );
      leaving.emit('close');
      await abandoned;
      await vi.waitFor(() => expect(abandonedStream.destroyed).toBe(true));

      const remounted = createRes();
      await serveThumbnail({}, remounted, drivePath, 'ffmpeg', cacheDir);
      expect(remounted.status).not.toHaveBeenCalled();
      expect(remounted.served).toBe('drive-jpeg');
      expect(mockGetThumbnailStream).toHaveBeenCalledTimes(2);

      // The abandoned download ends without discarding the new thumbnail
      // or being remembered as a failure.
      teardown.resolve();
      await vi.waitFor(() =>
        expect(cacheEntries()).toEqual([path.basename(driveCache())]),
      );
      const again = createRes();
      await serveThumbnail({}, again, drivePath, 'ffmpeg', cacheDir);
      expect(again.served).toBe('drive-jpeg');
      expect(mockGetThumbnailStream).toHaveBeenCalledTimes(2);
    });

    it('stops waiting when the client disconnects', async () => {
      mockGetThumbnailStream.mockReturnValue(new Promise(() => {}));

      const res = createRes();
      const pending = serveThumbnail({}, res, drivePath, 'ffmpeg', cacheDir);
      await vi.waitFor(() => expect(mockGetThumbnailStream).toHaveBeenCalled());
      res.emit('close');
      await pending;

      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
