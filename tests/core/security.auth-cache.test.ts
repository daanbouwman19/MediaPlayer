/**
 * authorizeFilePath caching around directory / library changes: decisions
 * made against a state that changed while they were being resolved must not
 * be cached (F87), and deactivated sources grant no access (F68).
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

vi.mock('../../src/core/database/database', () => ({
  getMediaDirectories: vi.fn(),
  isFileInLibrary: vi.fn(),
}));

import {
  authorizeFilePath,
  clearAuthCache,
} from '../../src/core/auth/security';
import {
  getMediaDirectories,
  isFileInLibrary,
} from '../../src/core/database/database';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('authorizeFilePath cache consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthCache();
    vi.mocked(getMediaDirectories).mockResolvedValue([]);
  });

  it('does not cache a decision that was in flight when the cache was cleared (F87)', async () => {
    const lookup = deferred<boolean>();
    vi.mocked(isFileInLibrary).mockReturnValueOnce(lookup.promise);

    const inFlight = authorizeFilePath('gdrive://file');
    // The source is removed while the lookup is still running.
    clearAuthCache();
    lookup.resolve(true);
    expect((await inFlight).isAllowed).toBe(true);

    vi.mocked(isFileInLibrary).mockResolvedValue(false);
    expect((await authorizeFilePath('gdrive://file')).isAllowed).toBe(false);
  });

  it('does not let later callers join a lookup that predates a clear (F87)', async () => {
    const stale = deferred<boolean>();
    vi.mocked(isFileInLibrary)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(false);

    const first = authorizeFilePath('gdrive://file');
    clearAuthCache();
    const second = authorizeFilePath('gdrive://file');
    stale.resolve(true);

    expect((await first).isAllowed).toBe(true);
    expect((await second).isAllowed).toBe(false);
    expect(isFileInLibrary).toHaveBeenCalledTimes(2);
  });

  it('still shares one lookup between concurrent callers', async () => {
    const lookup = deferred<boolean>();
    vi.mocked(isFileInLibrary).mockReturnValueOnce(lookup.promise);

    const a = authorizeFilePath('gdrive://file');
    const b = authorizeFilePath('gdrive://file');
    lookup.resolve(true);

    expect((await a).isAllowed).toBe(true);
    expect((await b).isAllowed).toBe(true);
    expect(isFileInLibrary).toHaveBeenCalledTimes(1);
    // ...and caches the result.
    expect((await authorizeFilePath('gdrive://file')).isAllowed).toBe(true);
    expect(isFileInLibrary).toHaveBeenCalledTimes(1);
  });

  describe('deactivated sources (F68)', () => {
    let root: string;
    let file: string;

    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'p08-auth-'));
      file = path.join(root, 'clip.mp4');
      fs.writeFileSync(file, 'data');
    });

    afterEach(() => {
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('denies files under an inactive local root', async () => {
      const source = {
        id: '1',
        path: root,
        type: 'local' as const,
        name: 'media',
        isActive: false,
      };
      vi.mocked(getMediaDirectories).mockResolvedValue([source]);
      expect((await authorizeFilePath(file)).isAllowed).toBe(false);

      clearAuthCache();
      vi.mocked(getMediaDirectories).mockResolvedValue([
        { ...source, isActive: true },
      ]);
      expect((await authorizeFilePath(file)).isAllowed).toBe(true);
    });
  });
});
