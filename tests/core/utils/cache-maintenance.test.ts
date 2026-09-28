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
import {
  CacheSweeper,
  pruneCacheDir,
} from '../../../src/core/media/utils/cache-maintenance';

const DAY = 24 * 60 * 60 * 1000;

const options = {
  isEntry: (name: string) => /^entry-\d+\.jpg$/.test(name),
  isTempFile: (name: string) => name.endsWith('.tmp'),
  maxAgeMs: 10 * DAY,
  tempMaxAgeMs: DAY,
};

describe('cache maintenance', () => {
  let dir: string;

  const createFile = (name: string, ageMs: number) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, 'x');
    const time = new Date(Date.now() - ageMs);
    fs.utimesSync(file, time, time);
    return file;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-maintenance-'));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('pruneCacheDir', () => {
    it('removes expired entries and stale temp files only', async () => {
      createFile('entry-1.jpg', 20 * DAY); // expired
      createFile('entry-2.jpg', DAY); // fresh
      createFile('partial.tmp', 2 * DAY); // stale temp
      createFile('recent.tmp', 60 * 1000); // temp still being written
      createFile('other-owner.json', 100 * DAY); // not ours
      fs.mkdirSync(path.join(dir, 'entry-3.jpg')); // not a file

      const removed = await pruneCacheDir(dir, options);

      expect(removed).toBe(2);
      expect(fs.readdirSync(dir).sort()).toEqual([
        'entry-2.jpg',
        'entry-3.jpg',
        'other-owner.json',
        'recent.tmp',
      ]);
    });

    it('returns 0 for a missing directory', async () => {
      await expect(
        pruneCacheDir(path.join(dir, 'missing'), options),
      ).resolves.toBe(0);
    });
  });

  describe('CacheSweeper', () => {
    it('sweeps a directory in the background at most once per interval', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
      createFile('entry-1.jpg', 20 * DAY);
      const sweeper = new CacheSweeper(options, DAY);

      sweeper.maybeSweep(dir);
      sweeper.maybeSweep(dir); // Same interval: no second sweep scheduled.
      expect(fs.existsSync(path.join(dir, 'entry-1.jpg'))).toBe(true);

      await vi.advanceTimersByTimeAsync(60 * 1000);
      await vi.waitFor(() =>
        expect(fs.existsSync(path.join(dir, 'entry-1.jpg'))).toBe(false),
      );

      // After the interval a new sweep runs again.
      createFile('entry-2.jpg', 20 * DAY);
      vi.setSystemTime(Date.now() + DAY + 1);
      sweeper.maybeSweep(dir);
      await vi.advanceTimersByTimeAsync(60 * 1000);
      await vi.waitFor(() =>
        expect(fs.existsSync(path.join(dir, 'entry-2.jpg'))).toBe(false),
      );
    });

    it('logs instead of throwing when a sweep fails', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout'] });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sweeper = new CacheSweeper({
        ...options,
        isEntry: () => {
          throw new Error('bad predicate');
        },
      });
      createFile('entry-1.jpg', 0);

      sweeper.maybeSweep(dir);
      await vi.advanceTimersByTimeAsync(60 * 1000);
      await vi.waitFor(() => expect(warn).toHaveBeenCalled());
      warn.mockRestore();
    });

    it('touch() keeps a used entry from expiring, once per process', async () => {
      const file = createFile('entry-1.jpg', 20 * DAY);
      const sweeper = new CacheSweeper(options);

      sweeper.touch(file);
      await vi.waitFor(() =>
        expect(Date.now() - fs.statSync(file).mtimeMs).toBeLessThan(DAY),
      );

      // A second touch in the same process is skipped.
      const old = new Date(Date.now() - 20 * DAY);
      fs.utimesSync(file, old, old);
      sweeper.touch(file);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(Date.now() - fs.statSync(file).mtimeMs).toBeGreaterThan(DAY);

      // Touching a file that vanished is harmless.
      sweeper.touch(path.join(dir, 'entry-404.jpg'));
    });
  });
});
