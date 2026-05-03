import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { registerSystemHandlers } from '../../../src/main/ipc/system-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import {
  addMediaDirectory,
  removeMediaDirectory,
  setDirectoryActiveState,
  getMediaDirectories,
} from '../../../src/core/database';
import { openMediaInVlc } from '../../../src/core/vlc-player';
import { listDirectory } from '../../../src/core/file-system';
import { getServerPort } from '../../../src/main/local-server';
import { shell, dialog, ipcMain, nativeTheme } from 'electron';
import fs from 'fs/promises';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/core/database', () => ({
  isFileInLibrary: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
  getMediaDirectories: vi.fn(),
}));

vi.mock('../../../src/core/vlc-player', () => ({
  openMediaInVlc: vi.fn(),
}));

vi.mock('../../../src/core/file-system', () => ({
  listDirectory: vi.fn(),
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

vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    realpath: vi.fn((p) => Promise.resolve(p)), // Mock realpath
  },
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
    it('adds valid directory', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const targetPath = '/valid/path';
      (fs.realpath as Mock).mockResolvedValue(targetPath); // realpath succeeds

      const result = await handler({}, targetPath);

      expect(fs.realpath).toHaveBeenCalledWith(targetPath);
      expect(addMediaDirectory).toHaveBeenCalledWith({
        path: targetPath,
        type: 'local',
      });
      expect(result).toBe(targetPath);
    });

    it('returns null if path inaccessible', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      (fs.realpath as Mock).mockRejectedValue(new Error('ENOENT'));

      const result = await handler({}, '/invalid/path');

      expect(result).toBeNull();
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });

    it('returns null if addMediaDirectory fails', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      (fs.realpath as Mock).mockResolvedValue('/valid/path');
      (addMediaDirectory as Mock).mockRejectedValue(new Error('DB Error'));

      const result = await handler({}, '/valid/path');

      expect(result).toBeNull();
    });

    it('returns null if no path provided', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const result = await handler({});
      expect(result).toBeNull();
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
    it('returns parent', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_PARENT_DIRECTORY);
      const result = await handler({}, '/path/to/file');
      // path.dirname('/path/to/file') should be '/path/to'
      // Note: testing logic relies on 'path' module which we didn't mock, so it uses real implementation
      expect(result).toBe('/path/to');
    });

    it('returns null if root', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_PARENT_DIRECTORY);
      const result = await handler({}, '/');
      expect(result).toBeNull();
    });

    it('returns null if empty', async () => {
      const handler = getHandler(IPC_CHANNELS.GET_PARENT_DIRECTORY);
      const result = await handler({}, '');
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
