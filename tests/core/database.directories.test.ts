/**
 * database.ts facade: directory-cache consistency (F87), the start-up
 * re-check of stored media directories (F83) and the validation of
 * client-supplied metadata (F13, F137).
 */
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
import type { MediaDirectory } from '../../src/core/media/types';

const mocks = vi.hoisted(() => {
  const instance = {
    init: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn(),
    terminate: vi.fn().mockResolvedValue(undefined),
    setOperationTimeout: vi.fn(),
  };
  class MockWorkerClient {
    constructor(_path: unknown, options: unknown) {
      mocksOptions.push(options);
      return instance;
    }
  }
  const mocksOptions: unknown[] = [];
  return { instance, MockWorkerClient, options: mocksOptions };
});

vi.mock('../../src/core/database/worker-client', () => ({
  WorkerClient: mocks.MockWorkerClient,
}));

vi.mock('../../src/core/auth/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/auth/security')>();
  return {
    ...actual,
    clearAuthCache: vi.fn(),
    isSensitiveDirectory: vi.fn(() => false),
  };
});

import {
  initDatabase,
  closeDatabase,
  getMediaDirectories,
  removeMediaDirectory,
  repairDriveSourceName,
  setDirectoryActiveState,
  upsertMetadata,
  updateWatchedSegments,
} from '../../src/core/database/database';
import {
  clearAuthCache,
  isSensitiveDirectory,
} from '../../src/core/auth/security';
import { AppError } from '../../src/core/media/errors';

const dir = (p: string, isActive = true): MediaDirectory => ({
  id: p,
  path: p,
  type: 'local',
  name: path.basename(p),
  isActive,
});

/** A promise plus its resolver, to control when the worker answers. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('database facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.instance.sendMessage.mockResolvedValue(undefined);
    vi.mocked(isSensitiveDirectory).mockReturnValue(false);
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('gives the database init its own, longer timeout', async () => {
    await initDatabase('/db', '/worker.js');
    expect(mocks.options.at(-1)).toEqual(
      expect.objectContaining({ operationTimeout: 30000, initTimeout: 120000 }),
    );
  });

  describe('media directory cache (F87)', () => {
    beforeEach(async () => {
      mocks.instance.sendMessage.mockResolvedValue([]);
      await initDatabase('/db', '/worker.js');
      mocks.instance.sendMessage.mockReset();
    });

    it('shares one worker read between concurrent callers', async () => {
      const read = deferred<MediaDirectory[]>();
      mocks.instance.sendMessage.mockReturnValueOnce(read.promise);

      const a = getMediaDirectories();
      const b = getMediaDirectories();
      read.resolve([dir('/media')]);

      expect(await a).toEqual([dir('/media')]);
      expect(await b).toEqual([dir('/media')]);
      expect(mocks.instance.sendMessage).toHaveBeenCalledTimes(1);
      // Served from the cache afterwards.
      expect(await getMediaDirectories()).toEqual([dir('/media')]);
      expect(mocks.instance.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('does not cache a read that was in flight when a directory was removed', async () => {
      const staleRead = deferred<MediaDirectory[]>();
      mocks.instance.sendMessage.mockImplementation((type: string) => {
        if (type === 'getMediaDirectories') return staleRead.promise;
        return Promise.resolve(undefined);
      });

      // A read posted before the mutation is answered afterwards with the
      // pre-mutation list (the worker handles messages in order).
      const inFlight = getMediaDirectories();
      await removeMediaDirectory('/removed');
      staleRead.resolve([dir('/kept'), dir('/removed')]);
      expect(await inFlight).toEqual([dir('/kept'), dir('/removed')]);

      mocks.instance.sendMessage.mockImplementation((type: string) =>
        Promise.resolve(
          type === 'getMediaDirectories' ? [dir('/kept')] : undefined,
        ),
      );
      expect(await getMediaDirectories()).toEqual([dir('/kept')]);
    });

    it('F93: re-reads the sources after a legacy Drive source is renamed', async () => {
      const legacy: MediaDirectory = {
        id: 'x',
        path: 'gdrive://abc',
        type: 'google_drive',
        name: 'abc',
        isActive: true,
      };
      let stored = legacy;
      mocks.instance.sendMessage.mockImplementation(
        (type: string, payload?: { name: string }) => {
          if (type === 'getMediaDirectories') return Promise.resolve([stored]);
          if (type === 'repairDriveSourceName' && payload) {
            stored = { ...stored, name: payload.name };
            return Promise.resolve(true);
          }
          return Promise.resolve(undefined);
        },
      );
      expect((await getMediaDirectories())[0]?.name).toBe('abc');

      await repairDriveSourceName('gdrive://abc', 'Holidays');

      expect(mocks.instance.sendMessage).toHaveBeenCalledWith(
        'repairDriveSourceName',
        { directoryPath: 'gdrive://abc', name: 'Holidays' },
      );
      expect((await getMediaDirectories())[0]?.name).toBe('Holidays');
    });

    it('F93: keeps the cached sources when no row was renamed', async () => {
      mocks.instance.sendMessage.mockImplementation((type: string) =>
        Promise.resolve(
          type === 'getMediaDirectories' ? [dir('/media')] : false,
        ),
      );
      await getMediaDirectories();
      vi.mocked(clearAuthCache).mockClear();

      await repairDriveSourceName('gdrive://abc', 'Holidays');

      expect(clearAuthCache).not.toHaveBeenCalled();
      await getMediaDirectories();
      expect(
        mocks.instance.sendMessage.mock.calls.filter(
          ([type]) => type === 'getMediaDirectories',
        ),
      ).toHaveLength(1);
    });

    it('clears the auth cache before and after a directory write', async () => {
      const write = deferred<undefined>();
      mocks.instance.sendMessage.mockReturnValueOnce(write.promise);
      vi.mocked(clearAuthCache).mockClear();

      const removal = removeMediaDirectory('/removed');
      expect(clearAuthCache).toHaveBeenCalledTimes(1);
      write.resolve(undefined);
      await removal;
      expect(clearAuthCache).toHaveBeenCalledTimes(2);
    });
  });

  describe('start-up re-check of stored directories (F83)', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p08-dirs-'));
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    const initWith = async (directories: MediaDirectory[]) => {
      mocks.instance.sendMessage.mockClear();
      mocks.instance.sendMessage.mockImplementation((type: string) =>
        Promise.resolve(
          type === 'getMediaDirectories' ? directories : undefined,
        ),
      );
      await initDatabase('/db', '/worker.js');
      return mocks.instance.sendMessage.mock.calls.filter(
        ([type]) => type !== 'getMediaDirectories',
      );
    };

    it('rewrites a symlinked legacy root to its canonical path', async () => {
      const target = path.join(tempDir, 'real-media');
      const link = path.join(tempDir, 'media-link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, 'junction');

      const writes = await initWith([dir(link)]);

      expect(writes).toEqual([
        [
          'canonicalizeMediaDirectory',
          { directoryPath: link, canonicalPath: fs.realpathSync(link) },
        ],
      ]);
    });

    it('leaves a legacy alias alone once it has been deactivated', async () => {
      const target = path.join(tempDir, 'real-media');
      const link = path.join(tempDir, 'media-link');
      fs.mkdirSync(target);
      fs.symlinkSync(target, link, 'junction');
      const real = fs.realpathSync(link);

      // First start: the worker deactivates the alias of the stored source.
      expect(await initWith([dir(link), dir(real)])).toEqual([
        [
          'canonicalizeMediaDirectory',
          { directoryPath: link, canonicalPath: real },
        ],
      ]);
      // Later starts send nothing, so the album cache is kept.
      expect(await initWith([dir(link, false), dir(real)])).toEqual([]);
    });

    it('resolves all roots at once, so offline shares cost one timeout', async () => {
      const realpath = vi
        .spyOn(fs, 'realpath')
        .mockImplementation((() => undefined) as never);
      vi.useFakeTimers();
      try {
        let settled = false;
        const init = initWith([
          dir(path.join(tempDir, 'offline-share-1')),
          dir(path.join(tempDir, 'offline-share-2')),
        ]).then((writes) => {
          settled = true;
          return writes;
        });

        await vi.advanceTimersByTimeAsync(2999);
        expect(realpath).toHaveBeenCalledTimes(2);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(settled).toBe(true);
        expect(await init).toEqual([]);
      } finally {
        vi.useRealTimers();
        realpath.mockRestore();
      }
    });

    it('deactivates a root that resolves to a sensitive location, without deleting it', async () => {
      const sensitive = path.join(tempDir, 'system');
      const link = path.join(tempDir, 'innocent-link');
      fs.mkdirSync(sensitive);
      fs.symlinkSync(sensitive, link, 'junction');
      const sensitiveReal = fs.realpathSync(sensitive);
      vi.mocked(isSensitiveDirectory).mockImplementation(
        (p) => p === sensitiveReal,
      );

      const writes = await initWith([dir(link)]);

      expect(isSensitiveDirectory).toHaveBeenCalledWith(link);
      expect(isSensitiveDirectory).toHaveBeenCalledWith(sensitiveReal);
      expect(writes).toEqual([
        ['setDirectoryActiveState', { directoryPath: link, isActive: false }],
      ]);
    });

    it('checks unresolvable roots by their stored path and leaves the rest alone', async () => {
      const canonical = fs.realpathSync(tempDir);
      const missing = path.join(tempDir, 'unplugged-disk');
      vi.mocked(isSensitiveDirectory).mockImplementation(
        (p) => p === '/etc-like',
      );

      const writes = await initWith([
        dir(canonical),
        dir(missing),
        dir('/etc-like', false), // already inactive
        dir('gdrive://folder'),
      ]);

      expect(writes).toEqual([]);
      expect(isSensitiveDirectory).toHaveBeenCalledWith(missing);
      expect(isSensitiveDirectory).not.toHaveBeenCalledWith('gdrive://folder');
    });

    it('never fails the database init', async () => {
      mocks.instance.sendMessage.mockRejectedValue(new Error('worker busy'));
      await expect(initDatabase('/db', '/worker.js')).resolves.toBeUndefined();
    });

    describe('re-activating a directory', () => {
      beforeEach(async () => {
        await initWith([]);
        mocks.instance.sendMessage.mockClear();
      });

      const activeStateWrites = () =>
        mocks.instance.sendMessage.mock.calls.filter(
          ([type]) => type === 'setDirectoryActiveState',
        );

      it('refuses a sensitive root', async () => {
        vi.mocked(isSensitiveDirectory).mockImplementation(
          (p) => p === '/etc-like',
        );

        const error = await setDirectoryActiveState('/etc-like', true).catch(
          (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).statusCode).toBe(403);
        expect(activeStateWrites()).toEqual([]);
      });

      it('refuses a root whose real path is sensitive', async () => {
        const sensitive = path.join(tempDir, 'system');
        const link = path.join(tempDir, 'innocent-link');
        fs.mkdirSync(sensitive);
        fs.symlinkSync(sensitive, link, 'junction');
        const sensitiveReal = fs.realpathSync(sensitive);
        vi.mocked(isSensitiveDirectory).mockImplementation(
          (p) => p === sensitiveReal,
        );

        await expect(setDirectoryActiveState(link, true)).rejects.toThrow(
          AppError,
        );
        expect(isSensitiveDirectory).toHaveBeenCalledWith(sensitiveReal);
        expect(activeStateWrites()).toEqual([]);
      });

      it('still re-activates safe, unresolvable and Drive roots', async () => {
        const missing = path.join(tempDir, 'unplugged-disk');
        await setDirectoryActiveState(tempDir, true);
        await setDirectoryActiveState(missing, true);
        await setDirectoryActiveState('gdrive://folder', true);

        expect(activeStateWrites()).toEqual([
          [
            'setDirectoryActiveState',
            { directoryPath: tempDir, isActive: true },
          ],
          [
            'setDirectoryActiveState',
            { directoryPath: missing, isActive: true },
          ],
          [
            'setDirectoryActiveState',
            { directoryPath: 'gdrive://folder', isActive: true },
          ],
        ]);
        expect(isSensitiveDirectory).not.toHaveBeenCalledWith(
          'gdrive://folder',
        );
      });

      it('always allows deactivating, even a sensitive root', async () => {
        vi.mocked(isSensitiveDirectory).mockReturnValue(true);
        await setDirectoryActiveState('/etc-like', false);
        expect(activeStateWrites()).toEqual([
          [
            'setDirectoryActiveState',
            { directoryPath: '/etc-like', isActive: false },
          ],
        ]);
      });
    });
  });

  describe('client-supplied metadata', () => {
    beforeEach(async () => {
      mocks.instance.sendMessage.mockResolvedValue([]);
      await initDatabase('/db', '/worker.js');
      mocks.instance.sendMessage.mockReset();
      mocks.instance.sendMessage.mockResolvedValue(undefined);
    });

    it('applies the authorized path last and drops unknown fields (F13)', async () => {
      await upsertMetadata('/media/ok.mp4', {
        rating: 3,
        filePath: 'gdrive://any-drive-file',
        inLibrary: true,
      } as never);

      expect(mocks.instance.sendMessage).toHaveBeenCalledWith(
        'upsertMetadata',
        {
          rating: 3,
          filePath: '/media/ok.mp4',
        },
      );
    });

    it('rejects malformed metadata without writing (F13)', async () => {
      await expect(
        upsertMetadata('/media/ok.mp4', { rating: 'five' } as never),
      ).rejects.toBeInstanceOf(AppError);
      expect(mocks.instance.sendMessage).not.toHaveBeenCalled();
    });

    it('normalizes watched segments and rejects oversized lists (F137)', async () => {
      await updateWatchedSegments(
        '/media/ok.mp4',
        JSON.stringify([{ start: 0, end: 2, extra: true }, { start: null }]),
      );
      expect(mocks.instance.sendMessage).toHaveBeenCalledWith(
        'updateWatchedSegments',
        { filePath: '/media/ok.mp4', segmentsJson: '[{"start":0,"end":2}]' },
      );

      await expect(
        updateWatchedSegments('/media/ok.mp4', 'not json'),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
