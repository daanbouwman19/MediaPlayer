import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  authorizeFilePath,
  filterAuthorizedPaths,
  escapeHtml,
  isRestrictedPath,
  isSensitiveDirectory,
  clearAuthCache,
} from '../../src/core/auth/security';
import path from 'path';
import fs from 'fs/promises';
import * as database from '../../src/core/database/database';
import { MAX_PATH_LENGTH } from '../../src/core/media/constants';

vi.mock('fs/promises', () => {
  const mock = {
    realpath: vi.fn(async (p) => p),
    readFile: vi.fn(),
  };
  return {
    ...mock,
    default: mock,
  };
});
vi.mock('../../src/core/database/database');

describe('filterAuthorizedPaths Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database.getMediaDirectories).mockResolvedValue([
      {
        path: '/allowed',
        type: 'local',
        id: '1',
        name: 'Allowed',
        isActive: true,
      },
      {
        path: 'gdrive://',
        type: 'google_drive',
        id: '2',
        name: 'Google Drive',
        isActive: true,
      },
    ]);
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) => p);
    // Mock isFileInLibrary
    (database as any).isFileInLibrary = vi
      .fn()
      .mockImplementation(async (p: string) => {
        return p === 'gdrive://valid';
      });
  });

  it('filters out unauthorized paths', async () => {
    const inputs = [
      '/allowed/file1.mp4',
      '/forbidden/file2.mp4',
      'gdrive://valid',
      '/allowed/../secret',
    ];

    const result = await filterAuthorizedPaths(inputs);

    expect(result).toEqual([
      path.resolve('/allowed/file1.mp4'),
      'gdrive://valid',
    ]);
  });

  it('uses cache on subsequent calls for filterAuthorizedPaths', async () => {
    // Cold cache:
    // 1 call to prime getMediaDirectories (initial call in filterAuthorizedPaths because > 1 file)
    // + 2 calls from authorizeFilePath misses (for each file)
    // = 3 total calls
    await filterAuthorizedPaths(['/allowed/1', '/allowed/2']);
    expect(database.getMediaDirectories).toHaveBeenCalledTimes(3);

    // Warm cache:
    // 1 call to prime getMediaDirectories (initial call in filterAuthorizedPaths because > 1 file)
    // + 0 calls from authorizeFilePath (cache hits)
    // = 1 additional call
    // Total = 3 + 1 = 4 calls
    await filterAuthorizedPaths(['/allowed/1', '/allowed/2']);
    expect(database.getMediaDirectories).toHaveBeenCalledTimes(4);
  });

  it('skips priming call for single file in filterAuthorizedPaths', async () => {
    clearAuthCache();
    vi.clearAllMocks();
    (database as any).getMediaDirectories.mockClear();

    // Cold cache for single file
    // 0 calls to prime (length <= 1)
    // + 1 call from authorizeFilePath miss
    // = 1 total call
    await filterAuthorizedPaths(['/allowed/single']);
    expect(database.getMediaDirectories).toHaveBeenCalledTimes(1);
  });

  it('returns canonical paths from filterAuthorizedPaths', async () => {
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) => {
      // simulate resolving symlinks or ..
      if (p === path.resolve('/allowed/../allowed/file.mp4'))
        return path.resolve('/allowed/file.mp4');
      return p;
    });

    const result = await filterAuthorizedPaths([
      '/allowed/../allowed/file.mp4',
    ]);
    expect(result).toEqual([path.resolve('/allowed/file.mp4')]);
  });
});

describe('authorizeFilePath Security', () => {
  beforeEach(() => {
    clearAuthCache();
    vi.clearAllMocks();
    vi.mocked(database.getMediaDirectories).mockResolvedValue([
      {
        path: '/allowed',
        type: 'local',
        id: '1',
        name: 'Allowed',
        isActive: true,
      },
      {
        path: 'gdrive://',
        type: 'google_drive',
        id: '2',
        name: 'Google Drive',
        isActive: true,
      },
    ]);
  });

  it('prevents file enumeration: returns uniform error message', async () => {
    // Case 1: File does not exist -> fs.realpath throws ENOENT for any path
    vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) => {
      if (p.includes('missing')) throw { code: 'ENOENT' };
      return p; // Return same path for roots etc.
    });

    const resultMissing = await authorizeFilePath('missing');

    // Case 2: File exists but not allowed -> fs.realpath returns forbidden path
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) => {
      if (p.includes('passwd')) return '/secret/passwd';
      return p; // /allowed remains /allowed
    });

    const resultForbidden = await authorizeFilePath('/secret/passwd');

    // VERIFY FIX: Messages should be identical "Access denied"
    expect(resultMissing.message).toBe('Access denied');
    expect(resultForbidden.message).toBe('Access denied');
  });

  it('validates absolute paths', async () => {
    // Inside allowed root
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) => p);
    const resultIn = await authorizeFilePath('/allowed/video.mp4');
    expect(resultIn.isAllowed).toBe(true);

    // Outside allowed root
    const resultOut = await authorizeFilePath('/absolute/path');
    expect(resultOut.isAllowed).toBe(false);
    expect(resultOut.message).toBe('Access denied');

    if (process.platform === 'win32') {
      const resultWin = await authorizeFilePath('C:\\Windows\\System32');
      expect(resultWin.isAllowed).toBe(false);
      expect(resultWin.message).toBe('Access denied');
    }
  });

  it('rejects traversal patterns', async () => {
    const cases = ['..', '../foo', 'bar/../../baz'];
    for (const c of cases) {
      const result = await authorizeFilePath(c);
      expect(result.isAllowed).toBe(false);
      expect(result.message).toBe('Access denied');
    }
  });

  it('rejects empty file path', async () => {
    const result = await authorizeFilePath('');
    expect(result.isAllowed).toBe(false);
    expect(result.message).toBe('Invalid file path');
  });

  it('allows access to valid gdrive:// paths', async () => {
    (database as any).isFileInLibrary = vi.fn().mockResolvedValue(true);
    const result = await authorizeFilePath('gdrive://fileId123');
    expect(result.isAllowed).toBe(true);
    expect(result.realPath).toBe('gdrive://fileId123');
  });

  it('allows access to gdrive:// paths even when they do not match the exact root', async () => {
    // This test ensures that if 'gdrive://' is an allowed root, specific file IDs like 'gdrive://12345' are allowed
    // even though path.relative might treat them weirdly if not handled correctly.
    (database as any).isFileInLibrary = vi.fn().mockResolvedValue(true);
    const result = await authorizeFilePath('gdrive://some-other-id');
    expect(result.isAllowed).toBe(true);
    expect(result.realPath).toBe('gdrive://some-other-id');
  });

  it('blocks access to gdrive:// paths NOT in library', async () => {
    (database as any).isFileInLibrary = vi.fn().mockResolvedValue(false);
    const result = await authorizeFilePath('gdrive://unknown-id');
    expect(result.isAllowed).toBe(false);
    expect(result.message).toBe('Access denied');
  });

  it('allows access to valid local files within allowed directories', async () => {
    const result = await authorizeFilePath('video.mp4');
    expect(result.isAllowed).toBe(true);
    expect(result.realPath).toContain('video.mp4');

    const resultAbs = await authorizeFilePath('/allowed/video.mp4');
    expect(resultAbs.isAllowed).toBe(true);
  });

  it('blocks access to sensitive subdirectories', async () => {
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) =>
      path.resolve(p),
    );
    const result = await authorizeFilePath('.env');
    expect(result.isAllowed).toBe(false);
    expect(result.message).toBe('Access to sensitive file denied');

    const resultAbs = await authorizeFilePath('/allowed/.env');
    expect(resultAbs.isAllowed).toBe(false);
    expect(resultAbs.message).toBe('Access to sensitive file denied');

    const result2 = await authorizeFilePath('node_modules/package.json');
    expect(result2.isAllowed).toBe(false);
    expect(result2.message).toBe('Access to sensitive file denied');

    // Additional sensitive files
    const resultKey = await authorizeFilePath('server.key');
    expect(resultKey.isAllowed).toBe(false);
    expect(resultKey.message).toBe('Access to sensitive file denied');

    const resultBash = await authorizeFilePath('.bashrc');
    expect(resultBash.isAllowed).toBe(false);
    expect(resultBash.message).toBe('Access to sensitive file denied');

    const resultSsh = await authorizeFilePath('id_rsa');
    expect(resultSsh.isAllowed).toBe(false);
    expect(resultSsh.message).toBe('Access to sensitive file denied');

    // System & User Data
    const resultAppData = await authorizeFilePath(
      'AppData/Local/Google/Chrome/User Data/Default/Login Data',
    );
    expect(resultAppData.isAllowed).toBe(false);
    expect(resultAppData.message).toBe('Access to sensitive file denied');

    const resultLibrary = await authorizeFilePath(
      'Library/Keychains/login.keychain',
    );
    expect(resultLibrary.isAllowed).toBe(false);
    expect(resultLibrary.message).toBe('Access to sensitive file denied');

    const resultNtUser = await authorizeFilePath('NTUSER.DAT');
    expect(resultNtUser.isAllowed).toBe(false);
    expect(resultNtUser.message).toBe('Access to sensitive file denied');
  });

  it('rejects overly long file paths (DoS prevention)', async () => {
    const longPath = 'a'.repeat(MAX_PATH_LENGTH + 1);
    const result = await authorizeFilePath(longPath);
    expect(result.isAllowed).toBe(false);
    expect(result.message).toBe('Invalid file path (too long)');

    // Path within limit should proceed to other checks (e.g. access denied)
    const okPath = 'a'.repeat(MAX_PATH_LENGTH);
    const resultOk = await authorizeFilePath(okPath);
    expect(resultOk.message).not.toBe('Invalid file path (too long)');
  });

  it('caches authorization results for short duration', async () => {
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) => p);

    // First call
    const result1 = await authorizeFilePath('/allowed/video.mp4');
    expect(result1.isAllowed).toBe(true);
    expect(database.getMediaDirectories).toHaveBeenCalledTimes(1);

    // Second call within TTL should use cache and not call getMediaDirectories
    const result2 = await authorizeFilePath('/allowed/video.mp4');
    expect(result2.isAllowed).toBe(true);
    expect(database.getMediaDirectories).toHaveBeenCalledTimes(1);

    // Call with explicit mediaDirectories should NOT use cache
    const customDirs = [
      {
        path: '/allowed',
        type: 'local',
        id: '1',
        name: 'Allowed',
        isActive: true,
      },
    ] as any;

    await authorizeFilePath('/allowed/video.mp4', customDirs);
    // getMediaDirectories is not called because we provided dirs,
    // but the cache should be bypassed (or updated, but since we provided args, we don't use cache)

    // Verify cache clearing
    clearAuthCache();
    await authorizeFilePath('/allowed/video.mp4');
    expect(database.getMediaDirectories).toHaveBeenCalledTimes(2);
  });
});

describe('escapeHtml Security', () => {
  it('escapes special characters', () => {
    const input = '<script>alert("xss")</script>';
    const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
    expect(escapeHtml(input)).toBe(expected);
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles strings without special characters', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

describe('Path Restriction Security', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
    vi.unstubAllEnvs();
  });

  describe('Windows', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.stubEnv('SystemDrive', 'C:');
      vi.stubEnv('SystemRoot', 'C:\\Windows');
      vi.stubEnv('ProgramFiles', 'C:\\Program Files');
      vi.stubEnv('ProgramFiles(x86)', 'C:\\Program Files (x86)');
      vi.stubEnv('ProgramData', 'C:\\ProgramData');
    });

    const sensitiveDirCases: [string, boolean][] = [
      ['C:\\', true],
      ['c:\\windows', true],
      ['C:\\Program Files', true],
      ['C:\\ProgramData', true],
      ['C:\\Users\\User\\Videos', false],
      ['D:\\Videos', false],
      ['C:\\SomeOtherFolder', false],
      // Case insensitivity
      ['c:\\WINDOWS', true],
      ['C:\\program files', true],
      // Edge cases
      ['', true], // Fail safe
    ];

    it.each(sensitiveDirCases)(
      'isSensitiveDirectory("%s") should be %s',
      (path, expected) => {
        expect(isSensitiveDirectory(path)).toBe(expected);
      },
    );

    const restrictedPathCases: [string, boolean][] = [
      ['C:\\Windows', true],
      ['c:\\program files', true],
      ['C:\\', false], // Allowed for navigation
      ['C:\\Users', false],
      // Sensitive component
      ['C:\\Users\\name\\.ssh', true],
      ['C:\\Users\\name\\.env', true],
      // Case insensitivity
      ['c:\\windows\\system32', true],
      // Unrestricted
      ['C:\\MyMedia', false],
      ['', true], // Fail safe
    ];

    it.each(restrictedPathCases)(
      'isRestrictedPath("%s") should be %s',
      (path, expected) => {
        expect(isRestrictedPath(path)).toBe(expected);
      },
    );
  });

  describe('Linux', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    const sensitiveDirCases: [string, boolean][] = [
      ['/', true],
      ['/etc', true],
      ['/usr/bin', true],
      ['/var/log', true],
      ['/home/user', false],
      ['/mnt/media', false],
      ['', true], // Fail safe
    ];

    it.each(sensitiveDirCases)(
      'isSensitiveDirectory("%s") should be %s',
      (path, expected) => {
        expect(isSensitiveDirectory(path)).toBe(expected);
      },
    );

    const restrictedPathCases: [string, boolean][] = [
      ['/etc', true],
      ['/root', true],
      ['/bin', true],
      ['/sbin', true],
      ['/usr', true],
      ['/lib', true],
      ['/opt', true],
      ['/var', true],
      // Allowed for navigation
      ['/', false],
      ['/home', false],
      ['/media', false],
      // Sensitive component
      ['/home/user/.ssh', true],
      ['/home/user/.env', true],
      ['/home/user/project/.git', true],
      ['', true], // Fail safe
    ];

    it.each(restrictedPathCases)(
      'isRestrictedPath("%s") should be %s',
      (path, expected) => {
        expect(isRestrictedPath(path)).toBe(expected);
      },
    );
  });
});

describe('Security Config Loading', () => {
  const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('loads custom sensitive directories from a valid config file', async () => {
    const mockConfig = JSON.stringify({
      sensitiveSubdirectories: ['custom_secret'],
    });

    // We need to import security AFTER resetModules to get fresh state
    const { loadSecurityConfig, isRestrictedPath } =
      await import('../../src/core/auth/security');
    // We need to import fs AFTER resetModules to ensure we're mocking the right instance if resetModules is used
    const fsMock = await import('fs/promises');
    vi.mocked(fsMock.readFile).mockResolvedValue(mockConfig);

    await loadSecurityConfig('/path/to/config.json');

    Object.defineProperty(process, 'platform', { value: 'linux' });
    expect(isRestrictedPath('/home/user/custom_secret')).toBe(true);
  });

  it('ignores missing config file (ENOENT)', async () => {
    const error: any = new Error('File not found');
    error.code = 'ENOENT';

    const { loadSecurityConfig } = await import('../../src/core/auth/security');
    const fsMock = await import('fs/promises');
    vi.mocked(fsMock.readFile).mockRejectedValue(error);

    await loadSecurityConfig('/missing/config.json');

    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('warns and throws on invalid JSON or read error', async () => {
    const { loadSecurityConfig } = await import('../../src/core/auth/security');
    const fsMock = await import('fs/promises');
    vi.mocked(fsMock.readFile).mockResolvedValue('{ invalid json ');

    await expect(loadSecurityConfig('/bad/config.json')).rejects.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalled();
  });
});
