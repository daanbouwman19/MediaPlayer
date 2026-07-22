import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { registerAuthHandlers } from '../../../src/main/ipc/auth-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import {
  generateAuthUrl,
  authenticateWithCode,
} from '../../../src/main/google-auth';
import { startAuthServer } from '../../../src/main/auth-server';
import { getDriveClient } from '../../../src/main/google-drive-service';
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
  getDriveClient: vi.fn(),
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
    it('fetches folder info and adds directory', async () => {
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE,
      )![1];

      const mockDrive = {
        files: {
          get: vi.fn().mockResolvedValue({
            data: { id: 'folder-id', name: 'Folder Name' },
          }),
        },
      };
      (getDriveClient as Mock).mockResolvedValue(mockDrive);

      const result = await handler({}, 'folder-id');

      expect(getDriveClient).toHaveBeenCalled();
      expect(mockDrive.files.get).toHaveBeenCalledWith({
        fileId: 'folder-id',
        fields: 'id, name',
      });
      expect(addMediaDirectory).toHaveBeenCalledWith({
        path: 'gdrive://folder-id',
        type: 'google_drive',
        name: 'Folder Name',
      });
      expect(result).toEqual({ name: 'Folder Name' });
    });

    it('uses default name if name missing', async () => {
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.ADD_GOOGLE_DRIVE_SOURCE,
      )![1];

      const mockDrive = {
        files: {
          get: vi.fn().mockResolvedValue({
            data: { id: 'folder-id' }, // no name
          }),
        },
      };
      (getDriveClient as Mock).mockResolvedValue(mockDrive);

      await handler({}, 'folder-id');

      expect(addMediaDirectory).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Google Drive Folder',
        }),
      );
    });
  });
});
