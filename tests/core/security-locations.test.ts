/**
 * Per-user data folders are sensitive by *location* (<profile>\AppData,
 * ~/Library), not by name: a media folder called "Library" or "AppData"
 * elsewhere must stay usable (previously any such segment was blocked).
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
import path from 'path';
import fs from 'fs/promises';
import {
  authorizeFilePath,
  clearAuthCache,
  isIgnoredDirectory,
  isInSensitiveLocation,
  isRestrictedPath,
  isSensitiveDirectory,
} from '../../src/core/auth/security';

vi.mock('fs/promises', () => {
  const mock = { realpath: vi.fn(async (p: string) => p), readFile: vi.fn() };
  return { ...mock, default: mock };
});
vi.mock('../../src/core/database/database', () => ({
  getMediaDirectories: vi.fn(),
  isFileInLibrary: vi.fn(),
}));

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform });
}

afterEach(() => {
  setPlatform(originalPlatform);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearAuthCache();
});

describe('isInSensitiveLocation', () => {
  describe('Windows', () => {
    beforeEach(() => {
      setPlatform('win32');
      vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\alice');
      vi.stubEnv('SystemDrive', 'C:');
      vi.stubEnv('PUBLIC', 'C:\\Users\\Public');
    });

    it.each([
      ['C:\\Users\\alice\\AppData', true],
      ['C:\\Users\\alice\\AppData\\Local\\Google\\Chrome', true],
      // Other profiles and case variations
      ['c:\\users\\BOB\\appdata\\roaming', true],
      // Ordinary folders that merely have these names
      ['D:\\Library\\Films', false],
      ['D:\\Media\\AppData', false],
      ['C:\\Users\\alice\\Videos\\AppData', false],
      ['C:\\Users\\alice', false],
      ['C:\\Users', false],
    ])('%s -> %s', (p, expected) => {
      expect(isInSensitiveLocation(p)).toBe(expected);
    });
  });

  describe('macOS', () => {
    beforeEach(() => {
      setPlatform('darwin');
      vi.spyOn(os, 'homedir').mockReturnValue('/Users/alice');
    });

    it.each([
      ['/Users/alice/Library', true],
      ['/Users/alice/Library/Keychains/login.keychain-db', true],
      ['/Users/bob/library/Mail', true],
      ['/Library/Keychains', true],
      ['/Volumes/Media/Library/Films', false],
      ['/Users/alice/Movies/Library', false],
      ['/Users/alice', false],
    ])('%s -> %s', (p, expected) => {
      expect(isInSensitiveLocation(p)).toBe(expected);
    });
  });

  it('never matches on Linux, which has no such folders', () => {
    setPlatform('linux');
    expect(isInSensitiveLocation('/home/alice/Library')).toBe(false);
    expect(isInSensitiveLocation('/home/alice/AppData')).toBe(false);
    expect(isInSensitiveLocation('')).toBe(false);
  });
});

describe('adding and browsing folders named Library / AppData', () => {
  it('accepts ordinary "library" folders on Linux (403 before)', () => {
    setPlatform('linux');
    expect(isSensitiveDirectory('/mnt/library/movies')).toBe(false);
    expect(isRestrictedPath('/mnt/library/movies')).toBe(false);
    expect(isRestrictedPath('/srv2/AppData/clips')).toBe(false);
  });

  it('accepts D:\\Library\\Films but still blocks the profile AppData on Windows', () => {
    setPlatform('win32');
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\alice');
    vi.stubEnv('SystemDrive', 'C:');
    expect(isSensitiveDirectory('D:\\Library\\Films')).toBe(false);
    expect(isRestrictedPath('D:\\Library\\Films')).toBe(false);
    expect(isSensitiveDirectory('C:\\Users\\alice\\AppData\\Roaming')).toBe(
      true,
    );
    expect(isRestrictedPath('C:\\Users\\alice\\AppData')).toBe(true);
    // The profile itself stays browsable.
    expect(isRestrictedPath('C:\\Users\\alice')).toBe(false);
  });

  it('blocks ~/Library but not other Library folders on macOS', () => {
    setPlatform('darwin');
    vi.spyOn(os, 'homedir').mockReturnValue('/Users/alice');
    expect(isRestrictedPath('/Users/alice/Library')).toBe(true);
    expect(isSensitiveDirectory('/Users/alice/Library/Mail')).toBe(true);
    expect(isSensitiveDirectory('/Volumes/Media/Library')).toBe(false);
  });
});

describe('isIgnoredDirectory (scanner)', () => {
  it('scans folders named Library outside the per-user data folder', () => {
    setPlatform('linux');
    expect(isIgnoredDirectory('Library', '/mnt/media/Library')).toBe(false);
    expect(isIgnoredDirectory('Library')).toBe(false);
    expect(isIgnoredDirectory('.git', '/mnt/media/.git')).toBe(true);
  });

  it('skips <profile>\\AppData when scanning a home folder on Windows', () => {
    setPlatform('win32');
    vi.spyOn(os, 'homedir').mockReturnValue('C:\\Users\\alice');
    expect(isIgnoredDirectory('AppData', 'C:\\Users\\alice\\AppData')).toBe(
      true,
    );
    expect(isIgnoredDirectory('AppData', 'D:\\Media\\AppData')).toBe(false);
  });
});

describe('authorizeFilePath below a home-folder source', () => {
  // Use the host's own path flavour so path.resolve behaves.
  const onWindows = originalPlatform === 'win32';
  const home = onWindows ? 'C:\\Users\\alice' : '/Users/alice';
  const dataFile = onWindows
    ? 'C:\\Users\\alice\\AppData\\Local\\Google\\Chrome\\Login Data'
    : '/Users/alice/Library/Keychains/login.keychain-db';
  const mediaFile = onWindows
    ? 'C:\\Users\\alice\\Videos\\Library\\clip.mp4'
    : '/Users/alice/Movies/Library/clip.mp4';

  beforeEach(() => {
    setPlatform(onWindows ? 'win32' : 'darwin');
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    vi.stubEnv('SystemDrive', 'C:');
    vi.mocked(fs.realpath).mockImplementation(async (p) =>
      path.resolve(String(p)),
    );
  });

  const dirs = [
    { path: home, type: 'local', id: '1', name: 'Home', isActive: true },
  ] as any;

  it('denies files in the per-user data folder', async () => {
    const result = await authorizeFilePath(dataFile, dirs);
    expect(result.isAllowed).toBe(false);
    expect(result.message).toBe('Access to sensitive file denied');
  });

  it('allows media in an ordinary folder named Library', async () => {
    const result = await authorizeFilePath(mediaFile, dirs);
    expect(result.isAllowed).toBe(true);
  });
});
