import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
} from 'vite-plus/test';

const { appListeners, mockApp, mockShutdownTranscoding, mockCloseDatabase } =
  vi.hoisted(() => {
    const appListeners = new Map<string, (...args: any[]) => unknown>();
    return {
      appListeners,
      mockApp: {
        isPackaged: true,
        on: vi.fn((event: string, listener: (...args: any[]) => unknown) => {
          appListeners.set(event, listener);
        }),
        quit: vi.fn(),
        requestSingleInstanceLock: vi.fn(() => true),
        getPath: vi.fn(() => '/user-data'),
        commandLine: { appendSwitch: vi.fn() },
      },
      mockShutdownTranscoding: vi.fn(),
      mockCloseDatabase: vi.fn(),
    };
  });

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows: vi.fn(() => []) }),
  dialog: { showErrorBox: vi.fn() },
  safeStorage: {},
  session: { defaultSession: {} },
}));
vi.mock('electron-log/main.js', () => ({
  default: {
    initialize: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('../../src/main/database', () => ({ initDatabase: vi.fn() }));
vi.mock('../../src/core/database/database', () => ({
  closeDatabase: mockCloseDatabase,
}));
vi.mock('../../src/core/auth/security', () => ({
  loadSecurityConfig: vi.fn(),
  registerSensitiveFile: vi.fn(),
}));
vi.mock('../../src/main/local-server', () => ({
  startLocalServer: vi.fn(),
  stopLocalServer: vi.fn(),
  getServerPort: vi.fn(() => 0),
  authorizeSessionRequests: vi.fn(),
}));
vi.mock('../../src/main/auth-server', () => ({ stopAuthServer: vi.fn() }));
vi.mock('../../src/main/drive-cache-manager', () => ({
  cleanupDriveCacheManager: vi.fn(),
  initializeDriveCacheManager: vi.fn(),
}));
vi.mock('../../src/main/ipc/auth-controller', () => ({
  registerAuthHandlers: vi.fn(),
}));
vi.mock('../../src/main/ipc/system-controller', () => ({
  registerSystemHandlers: vi.fn(),
}));
vi.mock('../../src/main/ipc/media-controller', () => ({
  registerMediaHandlers: vi.fn(),
}));
vi.mock('../../src/main/ipc/database-controller', () => ({
  registerDatabaseHandlers: vi.fn(),
}));
vi.mock('../../src/core/media/media-service', () => ({
  MediaService: vi.fn(),
}));
vi.mock('../../src/core/media/transcode-queue-manager', () => ({
  shutdownTranscoding: mockShutdownTranscoding,
}));
vi.mock('../../src/core/database/repositories/media-repository', () => ({
  MediaRepository: vi.fn(),
}));
vi.mock('../../src/infrastructure/node-file-system', () => ({
  NodeFileSystem: vi.fn(),
}));
vi.mock('../../src/infrastructure/worker-scanner-service', () => ({
  WorkerScannerService: vi.fn(),
}));
vi.mock('../../src/infrastructure/media-duration-handler', () => ({
  MediaDurationHandler: vi.fn(),
}));

/** Lets the before-quit promise chain run to completion. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('main process before-quit (F26)', () => {
  let beforeQuit: (event: { preventDefault: () => void }) => void;

  beforeAll(async () => {
    await import('../../src/main/main');
    const listener = appListeners.get('before-quit');
    if (!listener) throw new Error('before-quit listener not registered');
    beforeQuit = listener;
  });

  beforeEach(() => {
    mockApp.quit.mockClear();
    mockShutdownTranscoding.mockReset();
    mockCloseDatabase.mockReset();
  });

  it('holds the first quit until transcoding and the database are shut down', async () => {
    const order: string[] = [];
    let finishShutdown: () => void = () => {};
    mockShutdownTranscoding.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = () => {
            order.push('transcoding stopped');
            resolve();
          };
        }),
    );
    mockCloseDatabase.mockImplementation(async () => {
      order.push('database closed');
    });
    mockApp.quit.mockImplementation(() => {
      order.push('quit');
    });
    const event = { preventDefault: vi.fn() };

    beforeQuit(event);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await flush();
    expect(mockCloseDatabase).not.toHaveBeenCalled();
    expect(mockApp.quit).not.toHaveBeenCalled();

    finishShutdown();
    await flush();
    expect(order).toEqual(['transcoding stopped', 'database closed', 'quit']);

    // The quit that follows the cleanup goes through
    const second = { preventDefault: vi.fn() };
    beforeQuit(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(mockShutdownTranscoding).toHaveBeenCalledTimes(1);
  });

  it('still quits when the cleanup fails', async () => {
    vi.resetModules();
    appListeners.clear();
    await import('../../src/main/main');
    const freshBeforeQuit = appListeners.get('before-quit')!;
    mockShutdownTranscoding.mockRejectedValue(new Error('ffmpeg stuck'));
    const event = { preventDefault: vi.fn() };

    freshBeforeQuit(event);
    await flush();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockCloseDatabase).not.toHaveBeenCalled();
    expect(mockApp.quit).toHaveBeenCalledTimes(1);
  });

  it('registers no quit cleanup in a second instance', async () => {
    vi.resetModules();
    appListeners.clear();
    mockApp.requestSingleInstanceLock.mockReturnValueOnce(false);
    await import('../../src/main/main');

    expect(mockApp.quit).toHaveBeenCalledTimes(1);
    expect(appListeners.has('before-quit')).toBe(false);
    expect(appListeners.has('will-quit')).toBe(false);
  });
});
