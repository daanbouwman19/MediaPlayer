import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { registerSystemHandlers } from '../../../src/main/ipc/system-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import { addMediaDirectory } from '../../../src/core/database';
import { listDirectory } from '../../../src/core/file-system';
import fs from 'fs/promises';
import {
  isSensitiveDirectory,
  isRestrictedPath,
} from '../../../src/core/security';

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

vi.mock('../../../src/core/media-handler', () => ({
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

// Mock security module
vi.mock('../../../src/core/security', () => ({
  isSensitiveDirectory: vi.fn(),
  isRestrictedPath: vi.fn(),
}));

describe('system-controller security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (handleIpc as Mock).mockClear();
    registerSystemHandlers();
  });

  const getHandler = (channel: string) => {
    const call = (handleIpc as Mock).mock.calls.find((c) => c[0] === channel);
    if (!call) throw new Error(`Handler for ${channel} not found`);
    return call[1];
  };

  describe('ADD_MEDIA_DIRECTORY', () => {
    it('blocks sensitive directories', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const targetPath = '/sensitive/root';

      (fs.realpath as Mock).mockResolvedValue(targetPath);
      (isSensitiveDirectory as Mock).mockReturnValue(true);

      const result = await handler({}, targetPath);

      expect(isSensitiveDirectory).toHaveBeenCalledWith(targetPath);
      expect(addMediaDirectory).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('allows safe directories', async () => {
      const handler = getHandler(IPC_CHANNELS.ADD_MEDIA_DIRECTORY);
      const targetPath = '/safe/path';

      (fs.realpath as Mock).mockResolvedValue(targetPath);
      (isSensitiveDirectory as Mock).mockReturnValue(false);

      const result = await handler({}, targetPath);

      expect(isSensitiveDirectory).toHaveBeenCalledWith(targetPath);
      expect(addMediaDirectory).toHaveBeenCalled();
      expect(result).toBe(targetPath);
    });
  });

  describe('LIST_DIRECTORY', () => {
    it('blocks restricted paths', async () => {
      const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
      const targetPath = '/restricted/path';

      (isRestrictedPath as Mock).mockReturnValue(true);

      // We expect the handler to throw or return error/null
      // The current implementation returns the result of listDirectory directly
      // So if we block, we might throw an error or return null.
      // Ideally we should throw "Access denied" to match current behavior or return null.
      // Let's assume we want to throw 'Access denied' like in the server.

      await expect(handler({}, targetPath)).rejects.toThrow('Access denied');

      expect(isRestrictedPath).toHaveBeenCalledWith(targetPath);
      expect(listDirectory).not.toHaveBeenCalled();
    });

    it('allows safe paths', async () => {
      const handler = getHandler(IPC_CHANNELS.LIST_DIRECTORY);
      const targetPath = '/safe/path';

      (isRestrictedPath as Mock).mockReturnValue(false);
      (listDirectory as Mock).mockResolvedValue([]);

      await handler({}, targetPath);

      expect(isRestrictedPath).toHaveBeenCalledWith(targetPath);
      expect(listDirectory).toHaveBeenCalledWith(targetPath);
    });
  });
});
