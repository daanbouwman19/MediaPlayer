import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs';
import { execFile } from 'child_process';
import { getVlcPath } from '../../../src/infrastructure/vlc-paths';

vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

type RegistryValues = Record<string, string>;

/** Answers `reg query <key> /v InstallDir` like reg.exe does. */
function mockRegistry(values: RegistryValues) {
  vi.mocked(execFile).mockImplementation(((
    _file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    const key = args[1] ?? '';
    const value = values[key];
    if (value === undefined) {
      callback(
        new Error('ERROR: The system was unable to find the key'),
        '',
        '',
      );
    } else {
      callback(
        null,
        `\r\n${key}\r\n    InstallDir    REG_SZ    ${value}\r\n\r\n`,
        '',
      );
    }
  }) as any);
}

describe('getVlcPath on Windows (F133)', () => {
  const originalPlatform = process.platform;
  let existing: string[];

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    existing = [];
    vi.spyOn(fs.promises, 'access').mockImplementation(async (p) => {
      if (!existing.includes(String(p))) throw new Error('ENOENT');
    });
    vi.stubEnv('ProgramFiles', 'D:\\Program Files');
    vi.stubEnv('ProgramW6432', 'D:\\Program Files');
    vi.stubEnv('ProgramFiles(x86)', 'D:\\Program Files (x86)');
    vi.stubEnv('SystemRoot', 'D:\\Windows');
    vi.stubEnv('PATH', '');
    mockRegistry({});
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('finds VLC in Program Files on a non-C: system drive', async () => {
    existing = ['D:\\Program Files\\VideoLAN\\VLC\\vlc.exe'];
    await expect(getVlcPath()).resolves.toBe(existing[0]);
  });

  it('finds a 32-bit install in Program Files (x86)', async () => {
    existing = ['D:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe'];
    await expect(getVlcPath()).resolves.toBe(existing[0]);
  });

  it('uses the InstallDir recorded in the registry', async () => {
    mockRegistry({ 'HKLM\\SOFTWARE\\VideoLAN\\VLC': 'E:\\Apps\\VLC' });
    existing = ['E:\\Apps\\VLC\\vlc.exe'];

    await expect(getVlcPath()).resolves.toBe('E:\\Apps\\VLC\\vlc.exe');
    expect(execFile).toHaveBeenCalledWith(
      'D:\\Windows\\System32\\reg.exe',
      ['query', 'HKLM\\SOFTWARE\\VideoLAN\\VLC', '/v', 'InstallDir'],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it('reads the 32-bit registry view and expands variables', async () => {
    vi.stubEnv('APPS', 'F:\\Tools');
    vi.mocked(execFile).mockImplementation(((
      _file: string,
      args: string[],
      _options: unknown,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      if (args[1] === 'HKLM\\SOFTWARE\\WOW6432Node\\VideoLAN\\VLC') {
        callback(
          null,
          '    InstallDir    REG_EXPAND_SZ    %APPS%\\VLC\r\n',
          '',
        );
      } else {
        callback(new Error('missing'), '', '');
      }
    }) as any);
    existing = ['F:\\Tools\\VLC\\vlc.exe'];

    await expect(getVlcPath()).resolves.toBe('F:\\Tools\\VLC\\vlc.exe');
  });

  it('ignores a registry entry whose folder no longer exists', async () => {
    mockRegistry({ 'HKLM\\SOFTWARE\\VideoLAN\\VLC': 'E:\\Gone' });
    await expect(getVlcPath()).resolves.toBeNull();
  });

  it('falls back to vlc.exe on an absolute PATH entry', async () => {
    vi.stubEnv('PATH', '.;relative\\bin;"G:\\Portable VLC";C:\\Windows');
    existing = [
      'G:\\Portable VLC\\vlc.exe',
      '.\\vlc.exe',
      'relative\\bin\\vlc.exe',
    ];

    await expect(getVlcPath()).resolves.toBe('G:\\Portable VLC\\vlc.exe');
  });

  it('reports VLC as missing when no lookup finds it', async () => {
    await expect(getVlcPath()).resolves.toBeNull();
  });

  it('survives a failing registry query', async () => {
    vi.mocked(execFile).mockImplementation(() => {
      throw new Error('spawn failed');
    });
    await expect(getVlcPath()).resolves.toBeNull();
  });
});
