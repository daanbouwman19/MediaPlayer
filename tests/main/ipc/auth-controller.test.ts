import { describe, it, expect, vi, beforeEach, Mock } from 'vite-plus/test';
import { registerAuthHandlers } from '../../../src/main/ipc/auth-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import {
  generateAuthUrl,
  authenticateWithCode,
} from '../../../src/main/google-auth';
import { startAuthServer } from '../../../src/main/auth-server';
import { getDriveFolderInfo } from '../../../src/main/google-drive-service';
import { addMediaDirectory } from '../../../src/core/database/database';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/main/google-auth', () => ({
  generateAuthUrl: vi.fn(),
  authenticateWithCode: vi.fn(),
  getPendingAuthState: vi.fn(() => 'test-state'),
}));

vi.mock('../../../src/main/auth-server', () => ({
  startAuthServer: vi.fn(),
}));

vi.mock('../../../src/main/google-drive-service', () => ({
  getDriveFolderInfo: vi.fn(),
}));

vi.mock('../../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  addMediaDirectory: vi.fn(),
}));

describe('auth-controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers handlers', () => {
    registerAuthHandlers();
    expect(handleIpc).toHaveBeenCalledWith(
      IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START,
      expect.any(Function),
    );
    expect(handleIpc).toHaveBeenCalledWith(
      IPC_CHANNELS.AUTH_GOOGLE_DRIVE_CODE,
      expect.any(Function),
    );
    expect(handleIpc).toHaveBeenCalledWith(
      IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE,
      expect.any(Function),
    );
  });

  describe('AUTH_GOOGLE_DRIVE_START', () => {
    it('generates url and starts server', async () => {
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START,
      )![1];

      (generateAuthUrl as Mock).mockReturnValue('http://auth-url');
      (startAuthServer as Mock).mockResolvedValue(undefined);

      const result = await handler();

      expect(generateAuthUrl).toHaveBeenCalled();
      expect(startAuthServer).toHaveBeenCalledWith(3000, expect.any(Function));
      expect(result).toBe('http://auth-url');
    });

    it('logs error if server start fails', async () => {
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START,
      )![1];

      (generateAuthUrl as Mock).mockReturnValue('http://auth-url');
      (startAuthServer as Mock).mockRejectedValue(new Error('Server fail'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await handler();

      // We need to wait a tick because startAuthServer is not awaited in the implementation?
      // Wait, in implementation: startAuthServer(3000).catch(...)
      // Since it's not awaited, we might need to rely on the fact that the promise rejection is handled.
      // But we can't easily wait for the catch block unless we return the promise.
      // The implementation returns 'http://auth-url' immediately.
      // However, startAuthServer is called.

      expect(startAuthServer).toHaveBeenCalled();
      // The error logging happens in the catch block.
      // Use waitFor to ensure we wait for the microtask/async operation to complete
      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to start auth server',
          expect.any(Error),
        );
      });
      consoleSpy.mockRestore();
    });
  });

  describe('AUTH_GOOGLE_DRIVE_CODE', () => {
    it('authenticates with code', async () => {
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.AUTH_GOOGLE_DRIVE_CODE,
      )![1];

      await handler({}, 'test-code');

      expect(authenticateWithCode).toHaveBeenCalledWith('test-code');
    });
  });

  describe('ADD_GOOGLE_DRIVE_SOURCE', () => {
    const getHandler = () => {
      registerAuthHandlers();
      return (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE,
      )![1];
    };

    it('looks the folder up and adds it as a named Drive source', async () => {
      (getDriveFolderInfo as Mock).mockResolvedValue({
        id: 'folder-id',
        name: 'Folder Name',
      });

      const result = await getHandler()({}, 'folder-id');

      expect(getDriveFolderInfo).toHaveBeenCalledWith('folder-id');
      expect(addMediaDirectory).toHaveBeenCalledWith({
        path: 'gdrive://folder-id',
        type: 'google_drive',
        name: 'Folder Name',
      });
      expect(result).toEqual({ name: 'Folder Name' });
    });

    it('stores the canonical folder ID (e.g. of My Drive or a shortcut target)', async () => {
      (getDriveFolderInfo as Mock).mockResolvedValue({
        id: '0AbCdEf',
        name: 'My Drive',
      });

      await getHandler()({}, 'root');

      expect(addMediaDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'gdrive://0AbCdEf' }),
      );
    });

    it('adds nothing when the ID is not a folder', async () => {
      (getDriveFolderInfo as Mock).mockRejectedValue(
        new Error('Not a Google Drive folder'),
      );

      await expect(getHandler()({}, 'file-id')).rejects.toThrow(
        'Not a Google Drive folder',
      );
      expect(addMediaDirectory).not.toHaveBeenCalled();
    });
  });
});
