import { describe, it, expect, vi, beforeEach, Mock } from 'vite-plus/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { validatePathAccess } from '../../src/main/utils/security-utils';
import { clearAuthCache } from '../../src/core/auth/security';
import {
  getMediaDirectories,
  isFileInLibrary,
} from '../../src/core/database/database';

vi.mock('../../src/core/database/database', () => ({
  getMediaDirectories: vi.fn(),
  isFileInLibrary: vi.fn(),
}));

// Exercises the real authorizeFilePath; only the database is faked.
describe('validatePathAccess', () => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mediaplayer-validate-')),
  );
  const mediaFile = path.join(root, 'clip.mp4');
  fs.writeFileSync(mediaFile, '');

  beforeEach(() => {
    clearAuthCache();
    vi.clearAllMocks();
    (getMediaDirectories as Mock).mockResolvedValue([
      { path: root, isActive: true },
      { path: 'gdrive://folder', isActive: true },
    ]);
    (isFileInLibrary as Mock).mockImplementation(
      async (p: string) => p === 'gdrive://in-library',
    );
  });

  it('returns the real path of a library file', async () => {
    await expect(validatePathAccess(mediaFile)).resolves.toBe(mediaFile);
  });

  it('rejects local files outside the media directories', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(validatePathAccess(os.homedir())).rejects.toThrow(
      'Access denied',
    );
  });

  it('accepts Drive files of the scanned library', async () => {
    await expect(validatePathAccess('gdrive://in-library')).resolves.toBe(
      'gdrive://in-library',
    );
    expect(isFileInLibrary).toHaveBeenCalledWith('gdrive://in-library');
  });

  // F70: gdrive:// paths used to bypass validation entirely.
  it('rejects Drive files that are not in the library', async () => {
    await expect(validatePathAccess('gdrive://any-file-id')).rejects.toThrow(
      'Access denied',
    );
  });

  it('rejects malformed Drive paths', async () => {
    await expect(
      validatePathAccess('gdrive://in-library/../other'),
    ).rejects.toThrow('Access denied');
  });

  it('rejects non-string payloads', async () => {
    await expect(validatePathAccess({} as unknown as string)).rejects.toThrow(
      'Invalid file path',
    );
  });
});
