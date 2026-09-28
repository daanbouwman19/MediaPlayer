/**
 * The Windows drive list must follow drives that are connected later: it is
 * reused only briefly, re-read for the picker's root listing, and a failed
 * fsutil call is never cached.
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
import { execa } from 'execa';
import {
  clearDrivesCache,
  listDirectory,
  listDrives,
} from '../../src/core/media/file-system';

vi.mock('execa', () => ({ execa: vi.fn() }));

const fsutil = (drives: string) => ({ stdout: `Drives: ${drives}` }) as any;
const names = (entries: { name: string }[]) => entries.map((e) => e.name);

describe('listDrives cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrivesCache();
    vi.spyOn(os, 'platform').mockReturnValue('win32');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('ALLOWED_FS_ROOTS', '');
    vi.stubEnv('MEDIAPLAYER_WEB_MODE', '');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    clearDrivesCache();
  });

  it('reuses the list briefly, then re-reads it', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce(fsutil('C:\\'))
      .mockResolvedValueOnce(fsutil('C:\\ F:\\'));
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(names(await listDrives())).toEqual(['C:']);
    expect(names(await listDrives())).toEqual(['C:']);
    expect(execa).toHaveBeenCalledTimes(1);

    clock.mockReturnValue(now + 60_000);
    expect(names(await listDrives())).toEqual(['C:', 'F:']);
  });

  it('shows a drive plugged in after the first listing at the picker root', async () => {
    vi.mocked(execa)
      .mockResolvedValueOnce(fsutil('C:\\'))
      .mockResolvedValueOnce(fsutil('C:\\ F:\\'));

    expect(names(await listDirectory('ROOT'))).toEqual(['C:']);
    expect(names(await listDirectory('ROOT'))).toEqual(['C:', 'F:']);
  });

  it('does not cache the C:\\ fallback when fsutil fails', async () => {
    vi.mocked(execa)
      .mockRejectedValueOnce(new Error('fsutil unavailable'))
      .mockResolvedValueOnce(fsutil('C:\\ D:\\'));

    expect(names(await listDrives())).toEqual(['C:']);
    expect(names(await listDrives())).toEqual(['C:', 'D:']);
  });

  it('treats empty fsutil output as a failure', async () => {
    vi.mocked(execa).mockResolvedValueOnce(fsutil(''));

    expect(await listDrives()).toEqual([
      { name: 'C:', path: 'C:\\', isDirectory: true },
    ]);
    expect(console.error).toHaveBeenCalled();
  });

  it('runs fsutil once for concurrent callers', async () => {
    vi.mocked(execa).mockResolvedValue(fsutil('C:\\ D:\\'));

    const [a, b] = await Promise.all([listDrives(), listDrives()]);

    expect(names(a)).toEqual(['C:', 'D:']);
    expect(b).toBe(a);
    expect(execa).toHaveBeenCalledTimes(1);
  });
});
