import { describe, it, expect, vi, beforeEach, Mock } from 'vite-plus/test';
import { registerAuthHandlers } from '../../../src/main/ipc/auth-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import {
  generateAuthUrl,
  authenticateWithCode,
} from '../../../src/infrastructure/google-auth';
import { startAuthServer } from '../../../src/main/auth-server';
import { getDriveFolderInfo } from '../../../src/infrastructure/google-drive-service';
import { addMediaDirectory } from '../../../src/core/database/database';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/infrastructure/google-auth', () => ({
  generateAuthUrl: vi.fn(),
  authenticateWithCode: vi.fn(),
  getPendingAuthState: vi.fn(() => 'test-state'),
}));

vi.mock('../../../src/main/auth-server', () => ({
  startAuthServer: vi.fn(),
}));

vi.mock('../../../src/infrastructure/google-drive-service', () => ({
  getDriveFolderInfo: vi.fn(),
}));

vi.mock('../../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  addMediaDirectory: vi.fn(),
}));

vi.mock('../../../src/main/app-lock', () => ({
  getAppLockStatus: vi.fn(async () => ({
    enabled: true,
    isAuthenticated: false,
  })),
  unlockApp: vi.fn(async () => 'ok'),
  lockApp: vi.fn(),
  setAppPin: vi.fn(async () => undefined),
  clearAppPin: vi.fn(async () => undefined),
}));

describe('auth-controller', () => {
  describe('app lock handlers', () => {
    const getHandler = (channel: string) =>
      (handleIpc as Mock).mock.calls.find((c) => c[0] === channel)![1];

    it('delegates lock status, unlock, lock and PIN changes', async () => {
      const lock = await import('../../../src/main/app-lock');
      registerAuthHandlers();
      await expect(
        getHandler(IPC_CHANNELS.AUTH_LOCK_STATUS)({}),
      ).resolves.toEqual({ enabled: true, isAuthenticated: false });
      await expect(
        getHandler(IPC_CHANNELS.AUTH_UNLOCK)({}, '1234'),
      ).resolves.toBe('ok');
      expect(lock.unlockApp).toHaveBeenCalledWith('1234');
      getHandler(IPC_CHANNELS.AUTH_LOCK)({});
      expect(lock.lockApp).toHaveBeenCalled();
      await getHandler(IPC_CHANNELS.AUTH_SET_PIN)({}, '5678');
      expect(lock.setAppPin).toHaveBeenCalledWith('5678');
      await getHandler(IPC_CHANNELS.AUTH_CLEAR_PIN)({});
      expect(lock.clearAppPin).toHaveBeenCalled();
    });
  });

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

      vi.stubEnv('GOOGLE_REDIRECT_URI', '');
      let result: unknown;
      try {
        result = await handler();
      } finally {
        vi.unstubAllEnvs();
      }

      expect(generateAuthUrl).toHaveBeenCalled();
      expect(startAuthServer).toHaveBeenCalledWith(
        'http://localhost:12345/auth/google/callback',
        expect.any(Function),
      );
      expect(result).toBe('http://auth-url');
    });

    it('listens on the configured redirect URI', async () => {
      vi.stubEnv(
        'GOOGLE_REDIRECT_URI',
        'http://127.0.0.1:4321/auth/google/callback',
      );
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START,
      )![1];
      (generateAuthUrl as Mock).mockReturnValue('http://auth-url');
      (startAuthServer as Mock).mockResolvedValue(undefined);

      try {
        await handler();
      } finally {
        vi.unstubAllEnvs();
      }

      expect(startAuthServer).toHaveBeenCalledWith(
        'http://127.0.0.1:4321/auth/google/callback',
        expect.any(Function),
      );
    });

    it('reports a failure to start the callback server to the renderer', async () => {
      registerAuthHandlers();
      const handler = (handleIpc as Mock).mock.calls.find(
        (call) => call[0] === IPC_CHANNELS.AUTH_GOOGLE_DRIVE_START,
      )![1];

      (generateAuthUrl as Mock).mockReturnValue('http://auth-url');
      (startAuthServer as Mock).mockRejectedValue(new Error('EADDRINUSE'));

      await expect(handler()).rejects.toThrow('EADDRINUSE');
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
