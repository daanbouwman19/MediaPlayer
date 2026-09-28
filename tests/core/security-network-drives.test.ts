/**
 * Mapped network drives on Windows: the native realpath (libuv) expands
 * Z:\Movies to \\nas\media\Movies, which used to be rejected as a UNC path.
 * Folders on mapped drives must be accepted in their drive-letter form, while
 * UNC paths (and drives mapped to shares of this machine) stay blocked.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import os from 'os';

const { nativeRealpath, jsRealpath, promisesRealpath, promisesStat } =
  vi.hoisted(() => ({
    nativeRealpath: vi.fn(),
    jsRealpath: vi.fn(),
    promisesRealpath: vi.fn(),
    promisesStat: vi.fn(),
  }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const realpathSync = Object.assign((p: string) => actual.realpathSync(p), {
    native: nativeRealpath,
  });
  const realpath = (
    p: string,
    cb: (err: Error | null, resolved?: string) => void,
  ) => {
    try {
      cb(null, jsRealpath(p));
    } catch (err) {
      cb(err as Error);
    }
  };
  return {
    ...actual,
    realpathSync,
    realpath,
    default: { ...actual, realpathSync, realpath },
  };
});

vi.mock('fs/promises', () => {
  const mock = { realpath: promisesRealpath, stat: promisesStat };
  return { ...mock, default: mock };
});

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: 'Drives: C:\\ Z:\\ Y:\\' }),
}));

vi.mock('../../src/core/database/database', () => ({
  getMediaDirectories: vi.fn(),
  isFileInLibrary: vi.fn(),
}));

import {
  isRestrictedPath,
  isSensitiveDirectory,
} from '../../src/core/auth/security';
import {
  canonicalizePath,
  clearDrivesCache,
  resolveMediaSourceDirectory,
} from '../../src/core/media/file-system';

// Z: is a NAS share, Y: is (mis)mapped to this machine's administrative C$.
const MAPPINGS: Record<string, string> = {
  'z:': '\\\\nas\\media',
  'y:': '\\\\localhost\\C$',
};

function toUnc(p: string): string {
  const target = MAPPINGS[p.slice(0, 2).toLowerCase()];
  if (!target) {
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
  }
  return target + p.slice(2).replace(/\\$/, '');
}

const originalPlatform = process.platform;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process, 'platform', { value: 'win32' });
  vi.stubEnv('SystemDrive', 'C:');
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  vi.stubEnv('ProgramFiles', 'C:\\Program Files');
  vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)');
  vi.stubEnv('ProgramData', 'C:\\ProgramData');
  vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\alice');
  nativeRealpath.mockImplementation(toUnc);
  promisesRealpath.mockImplementation(async (p: string) => toUnc(p));
  // The JS realpath follows links but keeps the drive letter.
  jsRealpath.mockImplementation((p: string) => {
    toUnc(p);
    return p;
  });
  promisesStat.mockResolvedValue({ isDirectory: () => true });
  clearDrivesCache();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('restriction checks', () => {
  it('accepts a folder on a drive mapped to a NAS share', () => {
    expect(isSensitiveDirectory('Z:\\Movies')).toBe(false);
    expect(isRestrictedPath('Z:\\Movies')).toBe(false);
  });

  it('still blocks UNC paths, including loopback and admin shares', () => {
    expect(isSensitiveDirectory('\\\\nas\\media\\Movies')).toBe(true);
    expect(isRestrictedPath('\\\\localhost\\C$\\Windows')).toBe(true);
    expect(isRestrictedPath('\\\\?\\C:\\Windows')).toBe(true);
  });

  it('blocks a drive mapped to a share of this machine', () => {
    // Y:\Windows is really \\localhost\C$\Windows, i.e. C:\Windows.
    expect(isSensitiveDirectory('Y:\\Windows')).toBe(true);
    expect(isRestrictedPath('Y:\\Windows')).toBe(true);
  });
});

describe('canonicalizePath', () => {
  it('keeps the drive letter of a mapped network drive', async () => {
    await expect(canonicalizePath('Z:\\Movies')).resolves.toBe('Z:\\Movies');
  });

  it('keeps the native result when the input is already a UNC path', async () => {
    promisesRealpath.mockResolvedValueOnce('\\\\nas\\media\\Movies');
    await expect(canonicalizePath('\\\\nas\\media\\Movies')).resolves.toBe(
      '\\\\nas\\media\\Movies',
    );
    expect(jsRealpath).not.toHaveBeenCalled();
  });

  it('keeps a UNC result that a symlink really points to', async () => {
    promisesRealpath.mockResolvedValueOnce('\\\\evil\\share');
    jsRealpath.mockReturnValueOnce('\\\\evil\\share');
    const resolved = await canonicalizePath('C:\\link');
    expect(resolved).toBe('\\\\evil\\share');
    expect(isSensitiveDirectory(resolved)).toBe(true);
  });

  it('does not touch local paths', async () => {
    promisesRealpath.mockResolvedValueOnce('D:\\Media');
    await expect(canonicalizePath('D:\\Media')).resolves.toBe('D:\\Media');
    expect(jsRealpath).not.toHaveBeenCalled();
  });
});

// resolveMediaSourceDirectory resolves with the host's path module, so the
// end-to-end check only runs on a Windows host.
describe.runIf(originalPlatform === 'win32')(
  'resolveMediaSourceDirectory on a mapped drive',
  () => {
    it('returns the drive-letter path (null / 403 before)', async () => {
      await expect(resolveMediaSourceDirectory('Z:\\Movies')).resolves.toBe(
        'Z:\\Movies',
      );
    });

    it('rejects a drive mapped to an administrative share', async () => {
      await expect(
        resolveMediaSourceDirectory('Y:\\Windows'),
      ).rejects.toMatchObject({ statusCode: 403 });
    });
  },
);
