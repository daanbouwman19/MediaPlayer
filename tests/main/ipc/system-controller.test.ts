import { describe, it, expect, vi, beforeEach, Mock } from 'vite-plus/test';
import { registerSystemHandlers } from '../../../src/main/ipc/system-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import {
  addMediaDirectory,
  removeMediaDirectory,
  setDirectoryActiveState,
  getMediaDirectories,
} from '../../../src/core/database/database';
import { openMediaInVlc } from '../../../src/infrastructure/vlc-player';
import {
  getParentDirectory,
  listDirectory,
  resolveMediaSourceDirectory,
} from '../../../src/core/media/file-system';
import { getServerPort } from '../../../src/main/local-server';
import { shell, dialog, ipcMain, nativeTheme } from 'electron';
import path from 'path';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
  getMediaDirectories: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/infrastructure/vlc-player', () => ({
  openMediaInVlc: vi.fn(),
}));

// The real file-system / security behaviour is covered by
// system-controller.security.test.ts; here only the wiring is checked.
vi.mock('../../../src/core/media/file-system', () => ({
  listDirectory: vi.fn(),
  getParentDirectory: vi.fn(),
  resolveMediaSourceDirectory: vi.fn(),
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

describe('system-controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerSystemHandlers(); // Ensuring handlers are registered is tricky if they append. But handleIpc is a mock, so we can clear calls.
    (handleIpc as Mock).mockClear();
    registerSystemHandlers(); // Register again to capture fresh calls
  });

  const getHandler = (channel: string) => {
    const call = (handleIpc as Mock).mock.calls.find((c) => c[0] === channel);
    if (!call) throw new Error(`Handler for ${channel} not found`);
    return call[1];
  };

  describe('ADD_MEDIA_DIRECTORY', () => {
    it('adds the resolved directory', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const targetPath = '/valid/link';
      (resolveMediaSourceDirectory as Mock).mockResolvedValue('/valid/path');

      const result = await handler({}, targetPath);

      expect(resolveMediaSourceDirectory).toHaveBeenCalledWith(targetPath);
      expect(addMediaDirectory).toHaveBeenCalledWith({
        path: '/valid/path',
        type: 'local',
      });
      expect(result).toBe('/valid/path');
    });

    it('rejects with the validation error instead of returning null', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      (resolveMediaSourceDirectory as Mock).mockRejectedValue(
        new Error('Directory does not exist'),
      );

      await expect(handler({}, '/invalid/path')).rejects.toThrow(
        'Directory does not exist',
      );
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });

    it('rejects if addMediaDirectory fails', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      (resolveMediaSourceDirectory as Mock).mockResolvedValue('/valid/path');
      (addMediaDirectory as Mock).mockRejectedValue(new Error('DB Error'));

      await expect(handler({}, '/valid/path')).rejects.toThrow('DB Error');
    });

    it('returns null if no path provided', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const result = await handler({});
      expect(result).toBeNull();
    });

    it('rejects a folder nested inside an active source with a clear error', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const parent = path.resolve('/media/pictures');
      const child = path.join(parent, 'vacation');
      (resolveMediaSourceDirectory as Mock).mockResolvedValue(child);
      (getMediaDirectories as Mock).mockResolvedValueOnce([
        { id: '1', path: parent, type: 'local', name: 'p', isActive: true },
      ]);

      await expect(handler({}, child)).rejects.toThrow(
        /is inside the media source/,
      );
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });

    it('rejects a folder that contains an active source', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const parent = path.resolve('/media/pictures');
      const child = path.join(parent, 'vacation');
      (resolveMediaSourceDirectory as Mock).mockResolvedValue(parent);
      (getMediaDirectories as Mock).mockResolvedValueOnce([
        { id: '1', path: child, type: 'local', name: 'c', isActive: true },
      ]);

      await expect(handler({}, parent)).rejects.toThrow(
        /contains the media source/,
      );
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });

    it('allows a subfolder of an inactive source', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const parent = path.resolve('/media/pictures');
      const child = path.join(parent, 'vacation');
      (resolveMediaSourceDirectory as Mock).mockResolvedValue(child);
      (addMediaDirectory as Mock).mockResolvedValue(undefined);
      (getMediaDirectories as Mock).mockResolvedValueOnce([
        { id: '1', path: parent, type: 'local', name: 'p', isActive: false },
      ]);

      await expect(handler({}, child)).resolves.toBe(child);
      expect(addMediaDirectory).toHaveBeenCalledWith({
        path: child,
        type: 'local',
      });
    });
  });

  describe('REMOVE_MEDIA_DIRECTORY', () => {
    it('removes directory', async () => {
      const handler = getHandler(IPC_CHANNELS.REMOVE_MEDIA_DIRECTORY);
      await handler({}, '/path/to/remove');
      expect(removeMediaDirectory).toHaveBeenCalledWith('/path/to/remove');
    });
  });

  describe('SET_DIRECTORY_ACTIVE_STATE', () => {
    it('sets state', async () => {
      const handler = getHandler(IPC_CHANNELS.SET_DIRECTORY_ACTIVE_STATE);
      await handler({}, { directoryPath: '/path', isActive: true });
      expect(setDirectoryActiveState).toHaveBeenCalledWith('/path', true);
    });
  });

  describe('GET_MEDIA_DIRECTORIES', () => {
    it('returns directories', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_MEDIA_DIRECTORIES);
      (getMediaDirectories as Mock).mockResolvedValue(['dir1']);
      const result = await handler();
      expect(result).toEqual(['dir1']);
    });
  });

  describe('GET_SUPPORTED_EXTENSIONS', () => {
    it('returns extensions', () => {
      const handler = getHandler(IPC_CHANNELS.GET_SUPPORTED_EXTENSIONS);
      const result = handler();
      expect(result.images).toBeDefined();
      expect(result.videos).toBeDefined();
      expect(result.all).toBeDefined();
    });
  });

  describe('GET_SERVER_PORT', () => {
    it('returns port', () => {
      const handler = getHandler(IPC_CHANNELS.GET_SERVER_PORT);
      (getServerPort as Mock).mockReturnValue(3000);
      expect(handler()).toBe(3000);
    });
  });

  describe('OPEN_EXTERNAL', () => {
    it('opens external url after confirmation', async () => {
      const handler = getHandler(IPC_CHANNELS.OPEN_EXTERNAL);
      (dialog.showMessageBox as Mock).mockResolvedValue({ response: 1 }); // 1 = Open

      await handler({}, 'https://example.com');

      expect(dialog.showMessageBox).toHaveBeenCalled();
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('does not open if cancelled', async () => {
      const handler = getHandler(IPC_CHANNELS.OPEN_EXTERNAL);
      (dialog.showMessageBox as Mock).mockResolvedValue({ response: 0 }); // 0 = Cancel

      await handler({}, 'https://example.com');

      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('blocks non-http protocols', async () => {
      const handler = getHandler(IPC_CHANNELS.OPEN_EXTERNAL);
      console.warn = vi.fn();

      await handler({}, 'file://etc/passwd');

      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Blocked non-http protocol'),
      );
    });

    it('handles invalid urls gracefully', async () => {
      const handler = getHandler(IPC_CHANNELS.OPEN_EXTERNAL);
      await handler({}, 'not-a-url');
      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('OPEN_IN_VLC', () => {
    it('calls openMediaInVlc', async () => {
      const handler = getHandler(IPC_CHANNELS.OPEN_IN_VLC);
      (getServerPort as Mock).mockReturnValue(3000);

      await handler({}, '/path/to/media.mp4');

      expect(openMediaInVlc).toHaveBeenCalledWith('/path/to/media.mp4', 3000);
    });
  });

  describe('LIST_DIRECTORY', () => {
    it('lists directory', async () => {
      const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
      await handler({}, '/path');
      expect(listDirectory).toHaveBeenCalledWith('/path');
    });
  });

  describe('GET_PARENT_DIRECTORY', () => {
    it('returns the shared getParentDirectory result', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_PARENT_DIRECTORY);
      (getParentDirectory as Mock).mockResolvedValue('/path/to');
      const result = await handler({}, '/path/to/file');
      expect(getParentDirectory).toHaveBeenCalledWith('/path/to/file');
      expect(result).toBe('/path/to');
    });

    it('returns null at a root', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_PARENT_DIRECTORY);
      (getParentDirectory as Mock).mockResolvedValue(null);
      const result = await handler({}, '/');
      expect(result).toBeNull();
    });
  });

  describe('THEME_CHANGED', () => {
    it('sets themeSource for valid themes', () => {
      const handler = (ipcMain.on as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.THEME_CHANGED,
      )![1];

      handler({}, 'dark');
      expect(nativeTheme.themeSource).toBe('dark');

      handler({}, 'light');
      expect(nativeTheme.themeSource).toBe('light');

      handler({}, 'system');
      expect(nativeTheme.themeSource).toBe('system');
    });

    it('defaults to system for invalid themes', () => {
      const handler = (ipcMain.on as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.THEME_CHANGED,
      )![1];

      handler({}, 'pink');
      expect(nativeTheme.themeSource).toBe('system');

      handler({}, 'invalid');
      expect(nativeTheme.themeSource).toBe('system');
    });
  });
});
