/**
 * The directory IPC handlers against the real security and file-system
 * modules (only the disk itself is replaced by an in-memory tree), so the
 * restriction checks are exercised exactly as in the desktop app.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  Mock,
} from 'vite-plus/test';
import os from 'os';
import path from 'path';
import { registerSystemHandlers } from '../../../src/main/ipc/system-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import { addMediaDirectory } from '../../../src/core/database/database';
import { isRestrictedPath } from '../../../src/core/auth/security';
import { clearDrivesCache } from '../../../src/core/media/file-system';
import { virtualFs } from '../../utils/virtual-fs';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
  getMediaDirectories: vi.fn(),
}));

vi.mock('../../../src/infrastructure/vlc-player', () => ({
  openMediaInVlc: vi.fn(),
}));

vi.mock('../../../src/main/local-server', () => ({
  getServerPort: vi.fn(),
}));

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  nativeTheme: { themeSource: 'system' },
}));

// fsutil output on a Windows host (the drive of the test tree is included so
// the in-memory folders below are inside an allowed root).
const drives = vi.hoisted(() => ({ list: ['C:\\', 'D:\\'] }));
vi.mock('execa', () => ({
  execa: vi.fn(async () => ({ stdout: `Drives: ${drives.list.join(' ')}` })),
}));

vi.mock(
  'fs/promises',
  async () => (await import('../../utils/virtual-fs')).virtualFsModule,
);

const isWindowsHost = process.platform === 'win32';
// Where an installed build starts: NSIS perMachine installs run from
// Program Files; Linux packages typically live under /opt.
const installDir = isWindowsHost
  ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MediaPlayer')
  : '/opt/MediaPlayer';
const hostDrive = path.parse(path.resolve('/')).root.toUpperCase();

describe('system-controller security (real checks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    drives.list = Array.from(new Set(['C:\\', 'D:\\', hostDrive]));
    virtualFs.reset();
    clearDrivesCache();
    delete process.env.ALLOWED_FS_ROOTS;
    delete process.env.MEDIAPLAYER_WEB_MODE;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerSystemHandlers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const getHandler = (channel: string) => {
    const call = (handleIpc as Mock).mock.calls.find((c) => c[0] === channel);
    if (!call) throw new Error(`Handler for ${channel} not found`);
    return call[1];
  };

  describe('LIST_DIRECTORY', () => {
    it('lists the drives for ROOT when started from an install directory', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(installDir);
      // Resolved against the cwd, the sentinel is a restricted path: the old
      // handler checked it before listDirectory could recognise it.
      expect(isRestrictedPath('ROOT')).toBe(true);

      const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
      const expected = isWindowsHost
        ? drives.list.map((d) => ({
            name: d.replace(/\\$/, ''),
            path: d,
            isDirectory: true,
          }))
        : [{ name: 'Root', path: '/', isDirectory: true }];

      await expect(handler({}, 'ROOT')).resolves.toEqual(expected);
      await expect(handler({}, '')).resolves.toEqual(expected);
    });

    it('blocks restricted system directories', async () => {
      const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
      const restricted = isWindowsHost ? 'C:\\Windows\\System32' : '/etc';
      virtualFs.addDir(restricted);

      await expect(handler({}, restricted)).rejects.toThrow('Access denied');
    });

    it('lists an ordinary directory without hidden or sensitive entries', async () => {
      const dir = virtualFs.addDir('/virtual/media');
      virtualFs.addDir('/virtual/media/Films');
      virtualFs.addFile('/virtual/media/clip.mp4');
      virtualFs.addFile('/virtual/media/.env');
      virtualFs.addDir('/virtual/media/.git');

      const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
      const entries = await handler({}, dir);

      expect(entries.map((e: { name: string }) => e.name)).toEqual([
        'Films',
        'clip.mp4',
      ]);
    });

    it('hides the per-user data folder, but not other folders of that name', async () => {
      // A profile in the host's own path flavour: AppData on Windows,
      // Library on macOS (emulated on other hosts).
      const originalPlatform = process.platform;
      if (!isWindowsHost) {
        Object.defineProperty(process, 'platform', { value: 'darwin' });
      }
      const dataFolder = isWindowsHost ? 'AppData' : 'Library';
      const home = virtualFs.addDir('/Users/alice');
      virtualFs.addDir(`/Users/alice/${dataFolder}`);
      virtualFs.addDir('/Users/alice/Videos');
      virtualFs.addDir(`/Users/alice/Videos/${dataFolder}`);
      vi.spyOn(os, 'homedir').mockReturnValue(home);

      try {
        const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
        const names = (entries: { name: string }[]) =>
          entries.map((e) => e.name);

        expect(names(await handler({}, home))).toEqual(['Videos']);
        expect(names(await handler({}, path.join(home, 'Videos')))).toEqual([
          dataFolder,
        ]);
        await expect(handler({}, path.join(home, dataFolder))).rejects.toThrow(
          'Access denied',
        );
      } finally {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
        });
      }
    });
  });

  describe('ADD_MEDIA_DIRECTORY', () => {
    it('adds an existing folder by its resolved path', async () => {
      const dir = virtualFs.addDir('/virtual/media/Films');
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);

      await expect(handler({}, dir)).resolves.toBe(dir);
      expect(addMediaDirectory).toHaveBeenCalledWith({
        path: dir,
        type: 'local',
      });
    });

    it('adds a folder that is merely named Library', async () => {
      const dir = virtualFs.addDir('/virtual/Library/Films');
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);

      await expect(handler({}, dir)).resolves.toBe(dir);
      expect(addMediaDirectory).toHaveBeenCalled();
    });

    it('rejects sensitive system directories with an explicit error', async () => {
      const sensitive = isWindowsHost ? 'C:\\Windows' : '/etc';
      virtualFs.addDir(sensitive);
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);

      await expect(handler({}, sensitive)).rejects.toThrow(
        /Access restricted for sensitive system directories/,
      );
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });

    it('rejects a missing folder with an explicit error', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);

      await expect(
        handler({}, path.resolve('/virtual/missing')),
      ).rejects.toThrow('Directory does not exist');
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });

    it('confines additions to ALLOWED_FS_ROOTS when configured', async () => {
      const root = virtualFs.addDir('/virtual/media');
      const outside = virtualFs.addDir('/virtual/backup');
      process.env.ALLOWED_FS_ROOTS = root;
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);

      await expect(handler({}, outside)).rejects.toThrow(
        /outside allowed roots/,
      );
      expect(addMediaDirectory).not.toHaveBeenCalled();
      delete process.env.ALLOWED_FS_ROOTS;
    });
  });

  describe('GET_PARENT_DIRECTORY', () => {
    it('returns the parent, and null at a filesystem root', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_PARENT_DIRECTORY);
      const dir = path.resolve('/virtual/media/Films');

      await expect(handler({}, dir)).resolves.toBe(path.dirname(dir));
      await expect(handler({}, path.parse(dir).root)).resolves.toBeNull();
      await expect(handler({}, 'ROOT')).resolves.toBeNull();
    });
  });
});
