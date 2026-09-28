import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough, Writable } from 'stream';
import {
  cleanupDriveCacheManager,
  getDriveCacheManager,
  initializeDriveCacheManager,
} from '../../../src/infrastructure/drive-cache-manager';
import {
  getDriveFileMetadata,
  openDriveFileDownload,
} from '../../../src/infrastructure/google-drive-service';
import type { DriveCacheProgressEvent } from '../../../src/shared/ipc/media.contract';

// Only the Drive API is faked; the cache works against a real temp directory.
vi.mock('../../../src/infrastructure/google-drive-service', () => ({
  getDriveFileMetadata: vi.fn(),
  openDriveFileDownload: vi.fn(),
}));

const metadataMock = vi.mocked(getDriveFileMetadata);
const downloadMock = vi.mocked(openDriveFileDownload);

interface FakeDriveFile {
  content: Buffer;
  md5: string;
}

/** The fake Drive: files by id, served with real Range semantics. */
let drive: Map<string, FakeDriveFile>;
let cacheDir: string;

function putDriveFile(
  fileId: string,
  content: string | Buffer,
  md5 = 'md5-a',
): void {
  drive.set(fileId, {
    content: Buffer.isBuffer(content) ? content : Buffer.from(content),
    md5,
  });
}

function streamOf(data: Buffer): PassThrough {
  const stream = new PassThrough();
  stream.end(data);
  return stream;
}

/** Makes the next download of any file use `stream` as Drive's response. */
function nextDownloadFrom(stream: PassThrough, status = 200) {
  downloadMock.mockResolvedValueOnce({ stream, status, contentRange: null });
}

function useFakeDrive(): void {
  metadataMock.mockImplementation(async (fileId: string) => {
    const file = drive.get(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    return {
      id: fileId,
      size: String(file.content.length),
      mimeType: 'video/mp4',
      md5Checksum: file.md5,
    };
  });
  downloadMock.mockImplementation(async (fileId: string, start = 0) => {
    const file = drive.get(fileId);
    if (!file) throw new Error(`File not found: ${fileId}`);
    const total = file.content.length;
    return {
      stream: streamOf(file.content.subarray(start)),
      status: start > 0 ? 206 : 200,
      contentRange: start > 0 ? `bytes ${start}-${total - 1}/${total}` : null,
    };
  });
}

type Manager = ReturnType<typeof initializeDriveCacheManager>;

function createManager(options: { maxCacheBytes?: number } = {}): Manager {
  cleanupDriveCacheManager();
  return initializeDriveCacheManager(cacheDir, options);
}

function nextEvent(
  manager: Manager,
  fileId: string,
  status: DriveCacheProgressEvent['status'],
): Promise<DriveCacheProgressEvent> {
  return new Promise((resolve) => {
    const listener = (event: DriveCacheProgressEvent) => {
      if (event.fileId === fileId && event.status === status) {
        manager.off('progress', listener);
        resolve(event);
      }
    };
    manager.on('progress', listener);
  });
}

async function cacheFully(manager: Manager, fileId: string) {
  const ready = nextEvent(manager, fileId, 'ready');
  const cached = await manager.getCachedFilePath(fileId);
  await ready;
  return cached;
}

/**
 * Leaves the first `bytes` of a Drive file in the cache, as a session that
 * quit mid-download does, and returns the cache file's path.
 */
async function leavePartialDownload(
  fileId: string,
  bytes: number,
): Promise<string> {
  const file = drive.get(fileId)!;
  const { source, cached } = await startControlledDownload(
    createManager(),
    fileId,
  );
  source.write(file.content.subarray(0, bytes));
  await vi.waitFor(() => expect(fs.statSync(cached.path).size).toBe(bytes));
  cleanupDriveCacheManager();
  expect(source.destroyed).toBe(true);
  return cached.path;
}

/**
 * Starts caching `fileId` from a Drive response the test feeds by hand, and
 * waits until the cache file is open for writing.
 */
async function startControlledDownload(manager: Manager, fileId: string) {
  const source = new PassThrough();
  nextDownloadFrom(source);
  const cached = await manager.getCachedFilePath(fileId);
  await vi.waitFor(() => expect(fs.existsSync(cached.path)).toBe(true));
  return { source, cached };
}

function cacheFiles(): string[] {
  return fs.readdirSync(cacheDir).sort();
}

describe('DriveCacheManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-cache-test-'));
    drive = new Map();
    useFakeDrive();
  });

  afterEach(() => {
    cleanupDriveCacheManager();
    vi.restoreAllMocks();
    fs.rmSync(cacheDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('creates the cache directory', () => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    createManager();
    expect(fs.existsSync(cacheDir)).toBe(true);
  });

  it('downloads a file into the cache and reports it ready', async () => {
    putDriveFile('file-1', 'hello drive');
    const manager = createManager();

    const cached = await cacheFully(manager, 'file-1');

    expect(cached.totalSize).toBe(11);
    expect(cached.mimeType).toBe('video/mp4');
    expect(fs.readFileSync(cached.path, 'utf8')).toBe('hello drive');
    expect(await manager.getCacheStatus('file-1')).toEqual({
      status: 'ready',
      progress: 1,
    });
    expect(downloadMock).toHaveBeenCalledWith('file-1', 0);
  });

  it('serves a completed file again without downloading it twice', async () => {
    putDriveFile('file-1', 'hello drive');
    const manager = createManager();
    await cacheFully(manager, 'file-1');

    const again = await manager.getCachedFilePath('file-1');

    expect(fs.readFileSync(again.path, 'utf8')).toBe('hello drive');
    expect(downloadMock).toHaveBeenCalledTimes(1);
    expect(metadataMock).toHaveBeenCalledTimes(1);
  });

  it('starts a single download for concurrent requests', async () => {
    putDriveFile('file-1', 'hello drive');
    const manager = createManager();
    const ready = nextEvent(manager, 'file-1', 'ready');

    const [a, b] = await Promise.all([
      manager.getCachedFilePath('file-1'),
      manager.getCachedFilePath('file-1'),
    ]);
    await ready;

    expect(a.path).toBe(b.path);
    expect(downloadMock).toHaveBeenCalledTimes(1);
  });

  describe('persistence across restarts (F40)', () => {
    it('keeps cached files on shutdown and serves them offline afterwards', async () => {
      putDriveFile('file-1', 'offline movie');
      const cached = await cacheFully(createManager(), 'file-1');

      cleanupDriveCacheManager();
      expect(fs.existsSync(cached.path)).toBe(true);

      // Next session, without a network.
      metadataMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
      const next = createManager();

      expect(await next.getCacheStatus('file-1')).toEqual({
        status: 'ready',
        progress: 1,
      });
      const offline = await next.getCachedFilePath('file-1');
      expect(offline).toEqual({
        path: cached.path,
        totalSize: 13,
        mimeType: 'video/mp4',
      });
      expect(fs.readFileSync(offline.path, 'utf8')).toBe('offline movie');
      expect(downloadMock).toHaveBeenCalledTimes(1);
    });

    it('stops downloads on shutdown and resumes the partial file next session', async () => {
      const content = Buffer.from('0123456789abcdefghij');
      putDriveFile('file-1', content);
      const partialPath = await leavePartialDownload('file-1', 8);

      await cacheFully(createManager(), 'file-1');

      expect(downloadMock).toHaveBeenLastCalledWith('file-1', 8);
      expect(fs.readFileSync(partialPath)).toEqual(content);
    });

    it('does not report syncing forever for a download stopped by shutdown', async () => {
      putDriveFile('file-1', 'abcdef');
      const manager = createManager();
      await startControlledDownload(manager, 'file-1');
      expect((await manager.getCacheStatus('file-1')).status).toBe('syncing');

      manager.shutdown();

      await vi.waitFor(async () =>
        expect((await manager.getCacheStatus('file-1')).status).toBe('cloud'),
      );
    });

    it('clearCache deletes every cached file', async () => {
      putDriveFile('file-1', 'aaa');
      putDriveFile('file-2', 'bbb', 'md5-b');
      const manager = createManager();
      await cacheFully(manager, 'file-1');
      await cacheFully(manager, 'file-2');

      await manager.clearCache();

      expect(cacheFiles()).toEqual([]);
      expect((await manager.getCacheStatus('file-1')).status).toBe('cloud');
    });

    it('clearCache stops downloads in progress', async () => {
      putDriveFile('file-1', 'abcdef');
      const manager = createManager();
      const { source } = await startControlledDownload(manager, 'file-1');

      await manager.clearCache();

      expect(source.destroyed).toBe(true);
      await vi.waitFor(() => expect(cacheFiles()).toEqual([]));
    });
  });

  describe('failed downloads (F41, F129)', () => {
    it('lets a file be cached again after a failed start', async () => {
      putDriveFile('file-1', 'retry me');
      downloadMock.mockRejectedValueOnce(new Error('Token refresh failed'));
      const manager = createManager();
      const error = nextEvent(manager, 'file-1', 'error');

      // Streaming falls back to Drive; the failure is reported as an event.
      await manager.getCachedFilePath('file-1');
      expect((await error).error).toBe('Token refresh failed');
      expect((await manager.getCacheStatus('file-1')).status).toBe('cloud');

      const cached = await cacheFully(manager, 'file-1');

      expect(downloadMock).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(cached.path, 'utf8')).toBe('retry me');
    });

    it('lets triggerDownload retry after a failed start', async () => {
      putDriveFile('file-1', 'retry me');
      downloadMock.mockRejectedValueOnce(new Error('Network down'));
      const manager = createManager();

      await expect(manager.triggerDownload('file-1')).rejects.toThrow(
        'Network down',
      );
      const ready = nextEvent(manager, 'file-1', 'ready');
      await manager.triggerDownload('file-1');
      await ready;

      expect(await manager.getCacheStatus('file-1')).toEqual({
        status: 'ready',
        progress: 1,
      });
    });

    it('triggerDownload of a cached file is a no-op', async () => {
      putDriveFile('file-1', 'done');
      const manager = createManager();
      await cacheFully(manager, 'file-1');

      await manager.triggerDownload('file-1');

      expect(downloadMock).toHaveBeenCalledTimes(1);
    });

    it('reports a mid-download network error and resumes from the partial file', async () => {
      const content = Buffer.from('0123456789');
      putDriveFile('file-1', content);
      const manager = createManager();
      const { source, cached } = await startControlledDownload(
        manager,
        'file-1',
      );
      const failed = nextEvent(manager, 'file-1', 'error');

      source.write(content.subarray(0, 4));
      await vi.waitFor(() => expect(fs.statSync(cached.path).size).toBe(4));
      source.destroy(new Error('ECONNRESET'));

      expect((await failed).error).toBe('ECONNRESET');
      expect(await manager.getCacheStatus('file-1')).toEqual({
        status: 'cloud',
        progress: 0.4,
      });

      await cacheFully(manager, 'file-1');
      expect(downloadMock).toHaveBeenLastCalledWith('file-1', 4);
      expect(fs.readFileSync(cached.path)).toEqual(content);
    });

    it('reports a download that ends early as an error', async () => {
      putDriveFile('file-1', '0123456789');
      nextDownloadFrom(streamOf(Buffer.from('0123')));
      const manager = createManager();
      const failed = nextEvent(manager, 'file-1', 'error');

      await manager.getCachedFilePath('file-1');

      expect((await failed).error).toContain('ended after 4 of 10 bytes');
      expect((await manager.getCacheStatus('file-1')).status).toBe('cloud');
    });

    it('drops a download that delivered more bytes than the file has', async () => {
      putDriveFile('file-1', '0123');
      nextDownloadFrom(streamOf(Buffer.from('0123456789')));
      const manager = createManager();
      const failed = nextEvent(manager, 'file-1', 'error');

      await manager.getCachedFilePath('file-1');
      await failed;

      expect(cacheFiles()).toEqual([]);
    });

    it('rejects when Drive metadata is unavailable and nothing is cached', async () => {
      metadataMock.mockRejectedValue(
        new Error('User not authenticated with Google Drive'),
      );
      const manager = createManager();

      await expect(manager.triggerDownload('file-1')).rejects.toThrow(
        'User not authenticated with Google Drive',
      );
      await expect(manager.getCachedFilePath('file-1')).rejects.toThrow(
        'Drive metadata for file-1 is unavailable',
      );
    });

    it('reports a failed resume to a triggerDownload that joined it', async () => {
      putDriveFile('file-1', '0123456789');
      await leavePartialDownload('file-1', 4);
      let failOpen!: (err: Error) => void;
      downloadMock.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failOpen = reject;
          }),
      );
      const manager = createManager();

      // A streaming request resumes in the background and returns at once.
      expect((await manager.getCachedFilePath('file-1')).totalSize).toBe(10);
      const trigger = manager.triggerDownload('file-1');
      await vi.waitFor(() => expect(downloadMock).toHaveBeenCalledTimes(2));
      failOpen(new Error('Drive 503'));

      await expect(trigger).rejects.toThrow('Drive 503');
    });
  });

  describe('files larger than the cache (F42)', () => {
    it('streams an oversized file without caching it', async () => {
      putDriveFile('big', Buffer.alloc(200));
      const manager = createManager({ maxCacheBytes: 100 });

      const cached = await manager.getCachedFilePath('big');

      expect(cached.totalSize).toBe(200);
      expect(fs.existsSync(cached.path)).toBe(false);
      expect(downloadMock).not.toHaveBeenCalled();
      expect(await manager.getCacheStatus('big')).toEqual({
        status: 'cloud',
        progress: 0,
      });
    });

    it('explains why an oversized file cannot be made available offline', async () => {
      putDriveFile('big', Buffer.alloc(200));
      const manager = createManager({ maxCacheBytes: 100 });

      await expect(manager.triggerDownload('big')).rejects.toThrow(
        /too large for the offline cache/,
      );
    });

    it('evicts least-recently-used files but never the one that just finished', async () => {
      putDriveFile('a', Buffer.alloc(60), 'md5-a');
      putDriveFile('b', Buffer.alloc(60), 'md5-b');
      const sources = { a: new PassThrough(), b: new PassThrough() };
      downloadMock.mockImplementation(async (fileId: string) => ({
        stream: sources[fileId as 'a' | 'b'],
        status: 200,
        contentRange: null,
      }));
      const manager = createManager({ maxCacheBytes: 100 });

      // 'b' is requested first, so it is the least recently used entry by
      // the time it finishes, after 'a'.
      await manager.getCachedFilePath('b');
      await new Promise((resolve) => setTimeout(resolve, 5));
      await manager.getCachedFilePath('a');

      const aReady = nextEvent(manager, 'a', 'ready');
      sources.a.end(Buffer.alloc(60));
      await aReady;
      const bReady = nextEvent(manager, 'b', 'ready');
      sources.b.end(Buffer.alloc(60));
      await bReady;

      await vi.waitFor(async () =>
        expect((await manager.getCacheStatus('a')).status).toBe('cloud'),
      );
      expect((await manager.getCacheStatus('b')).status).toBe('ready');
    });

    it('makes room before a download starts', async () => {
      putDriveFile('a', Buffer.alloc(60), 'md5-a');
      putDriveFile('b', Buffer.alloc(60), 'md5-b');
      const manager = createManager({ maxCacheBytes: 100 });
      await cacheFully(manager, 'a');

      const source = new PassThrough();
      nextDownloadFrom(source);
      await manager.getCachedFilePath('b');

      await vi.waitFor(async () =>
        expect((await manager.getCacheStatus('a')).status).toBe('cloud'),
      );
      source.end(Buffer.alloc(60));
    });

    it('logs an eviction that fails and keeps going', async () => {
      putDriveFile('a', Buffer.alloc(60), 'md5-a');
      putDriveFile('b', Buffer.alloc(60), 'md5-b');
      const manager = createManager({ maxCacheBytes: 100 });
      await cacheFully(manager, 'a');

      const unlink = fs.promises.unlink;
      vi.spyOn(fs.promises, 'unlink').mockImplementation(async (target) => {
        if (String(target).includes(`${path.sep}a.`)) {
          throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        }
        return unlink(target);
      });
      await cacheFully(manager, 'b');

      await vi.waitFor(() =>
        expect(console.error).toHaveBeenCalledWith(
          '[DriveCache] Failed to delete %s:',
          expect.stringContaining(`${path.sep}a.`),
          expect.any(Error),
        ),
      );
      expect((await manager.getCacheStatus('b')).status).toBe('ready');
    });
  });

  describe('Drive revisions (F45)', () => {
    it('replaces the cached copy when the file changes on Drive', async () => {
      putDriveFile('file-1', 'version one', 'md5-v1');
      const manager = createManager();
      const v1 = await cacheFully(manager, 'file-1');

      putDriveFile('file-1', 'version two, longer', 'md5-v2');
      await manager.invalidateFile('file-1');
      const v2 = await cacheFully(manager, 'file-1');

      expect(v2.path).not.toBe(v1.path);
      expect(fs.existsSync(v1.path)).toBe(false);
      expect(fs.readFileSync(v2.path, 'utf8')).toBe('version two, longer');
    });

    it('re-checks the revision once cached metadata expires', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      putDriveFile('file-1', 'version one', 'md5-v1');
      const manager = createManager();
      const v1 = await cacheFully(manager, 'file-1');

      putDriveFile('file-1', 'version two', 'md5-v2');
      await manager.getCachedFilePath('file-1');
      expect(metadataMock).toHaveBeenCalledTimes(1);
      expect((await manager.getCacheStatus('file-1')).status).toBe('ready');

      now.mockReturnValue(1_000_000 + 5 * 60 * 1000);
      expect((await manager.getCacheStatus('file-1')).status).toBe('cloud');
      const v2 = await cacheFully(manager, 'file-1');

      expect(metadataMock).toHaveBeenCalledTimes(2);
      expect(fs.existsSync(v1.path)).toBe(false);
      expect(fs.readFileSync(v2.path, 'utf8')).toBe('version two');
    });

    it('never appends a new revision onto an old partial file after a restart', async () => {
      putDriveFile('file-1', 'AAAAAAAAAA', 'md5-v1');
      const partialPath = await leavePartialDownload('file-1', 4);

      putDriveFile('file-1', 'BBBBBBBBBBBB', 'md5-v2');
      const fresh = await cacheFully(createManager(), 'file-1');

      expect(downloadMock).toHaveBeenLastCalledWith('file-1', 0);
      expect(fs.readFileSync(fresh.path, 'utf8')).toBe('BBBBBBBBBBBB');
      expect(fs.existsSync(partialPath)).toBe(false);
    });

    it('restarts from scratch when Drive ignores the resume range', async () => {
      const content = Buffer.from('0123456789');
      putDriveFile('file-1', content);
      const partialPath = await leavePartialDownload('file-1', 4);

      // Drive answers the ranged request with the whole file (200).
      const ignoredRange = streamOf(content);
      nextDownloadFrom(ignoredRange);
      await cacheFully(createManager(), 'file-1');

      expect(ignoredRange.destroyed).toBe(true);
      expect(downloadMock).toHaveBeenNthCalledWith(2, 'file-1', 4);
      expect(downloadMock).toHaveBeenLastCalledWith('file-1', 0);
      expect(fs.readFileSync(partialPath)).toEqual(content);
    });

    it('restarts from scratch when Drive resumes at the wrong offset', async () => {
      const content = Buffer.from('0123456789');
      putDriveFile('file-1', content);
      const partialPath = await leavePartialDownload('file-1', 4);

      downloadMock.mockResolvedValueOnce({
        stream: streamOf(content.subarray(2)),
        status: 206,
        contentRange: 'bytes 2-9/10',
      });
      await cacheFully(createManager(), 'file-1');

      expect(downloadMock).toHaveBeenLastCalledWith('file-1', 0);
      expect(fs.readFileSync(partialPath)).toEqual(content);
    });

    it('drops unversioned, orphaned and corrupt cache files at startup', async () => {
      const write = (name: string, data: string) =>
        fs.writeFileSync(path.join(cacheDir, name), data);
      write('legacyDriveId123', 'pre-revision entry');
      write('orphan.0123456789abcdef.data', 'bytes without a manifest');
      write('corrupt.0123456789abcdef.json', '{not json');
      write('corrupt.0123456789abcdef.data', 'bytes');
      write('notes.txt', 'not a cache file');

      const manager = createManager();

      expect((await manager.getCacheStatus('legacyDriveId123')).status).toBe(
        'cloud',
      );
      expect(cacheFiles()).toEqual(['notes.txt']);
    });

    it('drops a manifest whose revision does not match its file name', async () => {
      putDriveFile('file-1', 'content');
      const cached = await cacheFully(createManager(), 'file-1');
      cleanupDriveCacheManager();

      const manifestPath = cached.path.replace(/\.data$/, '.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({ ...manifest, revision: 'md5:tampered' }),
      );

      const next = createManager();
      expect((await next.getCacheStatus('file-1')).status).toBe('cloud');
      expect(cacheFiles()).toEqual([]);
    });

    it('keeps a single revision when two are found for the same file', async () => {
      putDriveFile('file-1', 'one', 'md5-v1');
      const manager = createManager();
      await cacheFully(manager, 'file-1');
      const leftover = cacheFiles().map((name) => ({
        name,
        data: fs.readFileSync(path.join(cacheDir, name)),
      }));

      putDriveFile('file-1', 'two', 'md5-v2');
      await manager.invalidateFile('file-1');
      await cacheFully(manager, 'file-1');
      cleanupDriveCacheManager();
      // As if deleting the old revision had failed.
      for (const { name, data } of leftover) {
        fs.writeFileSync(path.join(cacheDir, name), data);
      }
      expect(cacheFiles()).toHaveLength(4);

      const next = createManager();
      await next.getCacheStatus('file-1');
      expect(cacheFiles()).toHaveLength(2);
    });
  });

  describe('progress events (F127)', () => {
    it('throttles progress events and always sends the final one', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
      putDriveFile('file-1', Buffer.alloc(1000));
      const manager = createManager();
      const events: DriveCacheProgressEvent[] = [];
      manager.on('progress', (event) => events.push(event));

      const { source } = await startControlledDownload(manager, 'file-1');
      const ready = nextEvent(manager, 'file-1', 'ready');
      for (let i = 0; i < 100; i++) {
        source.write(Buffer.alloc(10));
      }
      source.end();
      await ready;

      const syncing = events.filter((e) => e.status === 'syncing');
      expect(syncing).toHaveLength(1);
      expect(syncing[0]!.totalSize).toBe(1000);
      expect(events.at(-1)).toEqual({
        fileId: 'file-1',
        status: 'ready',
        progress: 1,
        downloadedBytes: 1000,
        totalSize: 1000,
      });
    });

    it('sends another progress event once the interval has passed', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000);
      putDriveFile('file-1', Buffer.alloc(100));
      const manager = createManager();
      const { source } = await startControlledDownload(manager, 'file-1');

      const first = nextEvent(manager, 'file-1', 'syncing');
      source.write(Buffer.alloc(50));
      expect((await first).progress).toBe(0.5);

      now.mockReturnValue(5_000_250);
      const second = nextEvent(manager, 'file-1', 'syncing');
      source.write(Buffer.alloc(25));
      expect((await second).progress).toBe(0.75);
      source.end(Buffer.alloc(25));
    });
  });

  describe('write errors (F128)', () => {
    it('destroys the Drive response and removes the partial file when a write fails', async () => {
      putDriveFile('file-1', 'abcdef');
      const source = streamOf(Buffer.from('abcdef'));
      nextDownloadFrom(source);
      vi.spyOn(fs, 'createWriteStream').mockImplementationOnce(
        () =>
          new Writable({
            write(_chunk, _encoding, callback) {
              callback(
                Object.assign(new Error('ENOSPC: no space left on device'), {
                  code: 'ENOSPC',
                }),
              );
            },
          }) as unknown as fs.WriteStream,
      );
      const manager = createManager();
      const failed = nextEvent(manager, 'file-1', 'error');

      await manager.getCachedFilePath('file-1');

      expect((await failed).error).toContain('ENOSPC');
      expect(source.destroyed).toBe(true);
      expect(cacheFiles()).toEqual([]);
    });
  });

  describe('getCacheStatus', () => {
    it('returns cloud for an empty id and for files that are not cached', async () => {
      const manager = createManager();
      expect(await manager.getCacheStatus('')).toEqual({
        status: 'cloud',
        progress: 0,
      });
      expect(await manager.getCacheStatus('unknown')).toEqual({
        status: 'cloud',
        progress: 0,
      });
      expect(metadataMock).not.toHaveBeenCalled();
    });

    it('reports syncing with progress while a download runs', async () => {
      putDriveFile('file-1', Buffer.alloc(100));
      const manager = createManager();
      const { source } = await startControlledDownload(manager, 'file-1');
      const progress = nextEvent(manager, 'file-1', 'syncing');
      source.write(Buffer.alloc(40));
      await progress;

      expect(await manager.getCacheStatus('file-1')).toEqual({
        status: 'syncing',
        progress: 0.4,
      });
      source.end(Buffer.alloc(60));
    });

    it('treats an empty Drive file as ready', async () => {
      putDriveFile('empty', Buffer.alloc(0));
      const manager = createManager();
      await cacheFully(manager, 'empty');
      expect(await manager.getCacheStatus('empty')).toEqual({
        status: 'ready',
        progress: 1,
      });
    });

    it('rejects invalid file ids', async () => {
      const manager = createManager();
      for (const bad of [null, '..', 'a/b', 'a\\b', 'a\0b', 'a:stream']) {
        await expect(manager.getCacheStatus(bad as any)).rejects.toThrow(
          'Invalid fileId',
        );
        await expect(manager.getCachedFilePath(bad as any)).rejects.toThrow(
          'Invalid fileId',
        );
      }
      await expect(manager.getCachedFilePath('')).rejects.toThrow(
        'Invalid fileId',
      );
    });
  });

  describe('invalidateFile', () => {
    it('removes the cached copy and forgets its metadata', async () => {
      putDriveFile('file-1', 'content');
      const manager = createManager();
      const cached = await cacheFully(manager, 'file-1');

      await manager.invalidateFile('file-1');

      expect(fs.existsSync(cached.path)).toBe(false);
      expect((await manager.getCacheStatus('file-1')).status).toBe('cloud');
      await cacheFully(manager, 'file-1');
      expect(metadataMock).toHaveBeenCalledTimes(2);
    });

    it('stops a running download of the file', async () => {
      putDriveFile('file-1', 'content');
      const manager = createManager();
      const { source } = await startControlledDownload(manager, 'file-1');

      await manager.invalidateFile('file-1');

      expect(source.destroyed).toBe(true);
      await vi.waitFor(() => expect(cacheFiles()).toEqual([]));
    });

    it('is a no-op for files that are not cached', async () => {
      const manager = createManager();
      await expect(manager.invalidateFile('nothing')).resolves.toBeUndefined();
    });
  });

  describe('singleton lifecycle', () => {
    it('returns the initialized instance', () => {
      const manager = createManager();
      expect(getDriveCacheManager()).toBe(manager);
      expect(initializeDriveCacheManager('elsewhere')).toBe(manager);
    });

    it('throws when used before initialization', () => {
      cleanupDriveCacheManager();
      expect(() => getDriveCacheManager()).toThrow(
        'DriveCacheManager has not been initialized.',
      );
    });

    it('cleanup is safe without an instance', () => {
      cleanupDriveCacheManager();
      expect(() => cleanupDriveCacheManager()).not.toThrow();
    });

    it('survives an unreadable cache directory', async () => {
      const readdir = vi
        .spyOn(fs.promises, 'readdir')
        .mockRejectedValueOnce(new Error('EACCES'));
      const manager = createManager();

      expect(await manager.getCacheStatus('file-1')).toEqual({
        status: 'cloud',
        progress: 0,
      });
      expect(readdir).toHaveBeenCalled();
    });
  });
});
