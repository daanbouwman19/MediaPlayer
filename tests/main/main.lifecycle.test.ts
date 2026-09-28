import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vite-plus/test';

const {
  appListeners,
  mockApp,
  mockShutdownTranscoding,
  mockCloseDatabase,
  mockBrowserWindow,
  createdWindows,
  mockShowErrorBox,
  mockInitDatabase,
  mockStartLocalServer,
  mockAuthorizeSessionRequests,
  mockDefaultSession,
} = vi.hoisted(() => {
  const appListeners = new Map<string, (...args: any[]) => unknown>();
  const createdWindows: any[] = [];
  const mockBrowserWindow = Object.assign(
    vi.fn(function () {
      const win = {
        webContents: { on: vi.fn(), setWindowOpenHandler: vi.fn() },
        loadFile: vi.fn(() => Promise.resolve()),
        loadURL: vi.fn(() => Promise.resolve()),
        on: vi.fn(),
        isMinimized: vi.fn(() => true),
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
      };
      createdWindows.push(win);
      return win;
    }),
    { getAllWindows: vi.fn(() => createdWindows) },
  );
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
    mockBrowserWindow,
    createdWindows,
    mockShowErrorBox: vi.fn(),
    mockInitDatabase: vi.fn((): Promise<void> => Promise.resolve()),
    mockStartLocalServer: vi.fn((): Promise<number> => Promise.resolve(4321)),
    mockAuthorizeSessionRequests: vi.fn(),
    mockDefaultSession: { id: 'default-session' },
  };
});

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('electron', () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  dialog: { showErrorBox: mockShowErrorBox },
  safeStorage: {},
  session: { defaultSession: mockDefaultSession },
}));
vi.mock('electron-log/main.js', () => ({
  default: {
    initialize: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('fs/promises', () => ({
  default: { mkdir: vi.fn(() => Promise.resolve()) },
}));
vi.mock('../../src/main/master-key-store', () => ({
  loadProtectedMasterKey: vi.fn(() => null),
}));
vi.mock('../../src/main/database', () => ({ initDatabase: mockInitDatabase }));
vi.mock('../../src/core/database/database', () => ({
  closeDatabase: mockCloseDatabase,
}));
vi.mock('../../src/core/auth/security', () => ({
  loadSecurityConfig: vi.fn(() => Promise.resolve()),
  registerSensitiveFile: vi.fn(),
}));
vi.mock('../../src/main/local-server', () => ({
  startLocalServer: mockStartLocalServer,
  stopLocalServer: vi.fn(),
  getServerPort: vi.fn(() => 0),
  authorizeSessionRequests: mockAuthorizeSessionRequests,
}));
vi.mock('../../src/main/auth-server', () => ({ stopAuthServer: vi.fn() }));
vi.mock('../../src/infrastructure/drive-cache-manager', () => ({
  cleanupDriveCacheManager: vi.fn(),
  initializeDriveCacheManager: vi.fn(() => ({ on: vi.fn() })),
}));
vi.mock('../../src/main/lock-triggers', () => ({
  registerLockTriggers: vi.fn(),
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

describe('main process startup (F132, F38)', () => {
  const originalMasterKeyDir = process.env.MASTER_KEY_DIR;

  /** Loads a fresh main.ts and returns a lookup for its app listeners. */
  const loadMain = async () => {
    vi.resetModules();
    appListeners.clear();
    await import('../../src/main/main');
    return (event: string) => {
      const found = appListeners.get(event);
      if (!found) throw new Error(`${event} listener not registered`);
      return found;
    };
  };

  beforeEach(() => {
    createdWindows.length = 0;
    mockBrowserWindow.mockClear();
    mockApp.quit.mockReset();
    mockShowErrorBox.mockClear();
    mockAuthorizeSessionRequests.mockClear();
    mockInitDatabase.mockReset();
    mockInitDatabase.mockImplementation(() => Promise.resolve());
    mockStartLocalServer.mockReset();
    mockStartLocalServer.mockImplementation(() => Promise.resolve(4321));
  });

  afterAll(() => {
    if (originalMasterKeyDir === undefined) delete process.env.MASTER_KEY_DIR;
    else process.env.MASTER_KEY_DIR = originalMasterKeyDir;
  });

  it('creates the window only once the local server is listening', async () => {
    let listen: (port: number) => void = () => {};
    mockStartLocalServer.mockImplementation(
      () =>
        new Promise<number>((resolve) => {
          listen = resolve;
        }),
    );
    const listener = await loadMain();

    listener('ready')();
    await flush();

    expect(mockStartLocalServer).toHaveBeenCalledTimes(1);
    expect(mockBrowserWindow).not.toHaveBeenCalled();
    expect(mockAuthorizeSessionRequests).not.toHaveBeenCalled();

    listen(4321);
    await flush();

    expect(mockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeSessionRequests).toHaveBeenCalledWith(
      mockDefaultSession,
      4321,
    );
    expect(
      mockAuthorizeSessionRequests.mock.invocationCallOrder[0],
    ).toBeLessThan(mockBrowserWindow.mock.invocationCallOrder[0]!);
    expect(mockShowErrorBox).not.toHaveBeenCalled();
    expect(mockApp.quit).not.toHaveBeenCalled();
  });

  it('shows an error and quits without a window when the database fails', async () => {
    mockInitDatabase.mockRejectedValue(new Error('database is locked'));
    const listener = await loadMain();

    listener('ready')();
    await flush();

    expect(mockShowErrorBox).toHaveBeenCalledWith(
      'MediaPlayer could not start',
      expect.stringContaining('database is locked'),
    );
    expect(mockApp.quit).toHaveBeenCalledTimes(1);
    expect(mockStartLocalServer).not.toHaveBeenCalled();
    expect(mockBrowserWindow).not.toHaveBeenCalled();
  });

  it('shows an error and quits without a window when the server cannot listen', async () => {
    mockStartLocalServer.mockRejectedValue(new Error('listen EADDRINUSE'));
    const listener = await loadMain();

    listener('ready')();
    await flush();

    expect(mockShowErrorBox).toHaveBeenCalledWith(
      'MediaPlayer could not start',
      expect.stringContaining('listen EADDRINUSE'),
    );
    expect(mockApp.quit).toHaveBeenCalledTimes(1);
    expect(mockAuthorizeSessionRequests).not.toHaveBeenCalled();
    expect(mockBrowserWindow).not.toHaveBeenCalled();
  });

  it('opens no window from second-instance or activate before startup completes', async () => {
    mockStartLocalServer.mockImplementation(
      () => new Promise<number>(() => {}),
    );
    const listener = await loadMain();

    listener('ready')();
    await flush();
    listener('second-instance')();
    listener('activate')();

    expect(mockBrowserWindow).not.toHaveBeenCalled();
  });

  it('restores, shows and focuses the existing window on second-instance', async () => {
    const listener = await loadMain();

    listener('ready')();
    await flush();
    expect(mockBrowserWindow).toHaveBeenCalledTimes(1);
    const win = createdWindows[0];

    listener('second-instance')();

    expect(mockBrowserWindow).toHaveBeenCalledTimes(1);
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(win.show).toHaveBeenCalledTimes(1);
    expect(win.focus).toHaveBeenCalledTimes(1);
  });

  it('opens a new window on second-instance once the old one was closed', async () => {
    const listener = await loadMain();

    listener('ready')();
    await flush();
    const win = createdWindows[0];
    const closedCall = win.on.mock.calls.find(
      (call: unknown[]) => call[0] === 'closed',
    );
    (closedCall[1] as () => void)();

    listener('second-instance')();

    expect(mockBrowserWindow).toHaveBeenCalledTimes(2);
    expect(win.focus).not.toHaveBeenCalled();
  });
});
