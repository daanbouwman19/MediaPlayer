import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  Mock,
} from 'vitest';
import { ipcMain } from 'electron';

// Hoist the mock function so it's accessible in the factory and the test
const mocks = vi.hoisted(() => {
  const fsAccess = vi.fn();
  const realpath = vi.fn();
  return {
    mockSpawn: vi.fn(),
    mockFsAccess: fsAccess,
    mockRealpath: realpath,
    mockGetMediaDirectories: vi.fn(),
    fsPromisesMock: {
      access: fsAccess,
      stat: vi.fn(),
      readFile: vi.fn(),
      realpath: realpath,
    },
  };
});

// Mock path module to be platform-aware based on process.platform
// Mock path module to be platform-aware based on process.platform
const mockPath = vi.hoisted(() => {
  const win32 = {
    relative: (from: string, to: string) => {
      if (to.startsWith(from)) {
        return to.slice(from.length).replace(/^\\/, '');
      }
      return '..\\outside';
    },
    isAbsolute: (p: string) => /^[a-zA-Z]:\\/.test(p),
    sep: '\\',
    join: (...args: string[]) => args.join('\\'),
    normalize: (p: string) => p,
    resolve: (...args: string[]) => {
      for (let i = args.length - 1; i >= 0; i--) {
        if (/^[a-zA-Z]:\\/.test(args[i])) return args[i];
      }
      return args.join('\\');
    },
    dirname: (p: string) => p.substring(0, p.lastIndexOf('\\')),
    basename: (p: string) => p.substring(p.lastIndexOf('\\') + 1),
    extname: (p: string) => p.substring(p.lastIndexOf('.')),
  };
  const posix = {
    relative: (from: string, to: string) => {
      if (to.startsWith(from)) {
        return to.slice(from.length).replace(/^\//, '');
      }
      return '../outside';
    },
    isAbsolute: (p: string) => p.startsWith('/'),
    sep: '/',
    join: (...args: string[]) => args.join('/'),
    normalize: (p: string) => p,
    resolve: (...args: string[]) => {
      for (let i = args.length - 1; i >= 0; i--) {
        if (args[i].startsWith('/')) return args[i];
      }
      return args.join('/');
    },
    dirname: (p: string) => p.substring(0, p.lastIndexOf('/')),
    basename: (p: string) => p.substring(p.lastIndexOf('/') + 1),
    extname: (p: string) => p.substring(p.lastIndexOf('.')),
  };
  return { win32, posix };
});

vi.mock('path', () => {
  const getActive = () =>
    process.platform === 'win32' ? mockPath.win32 : mockPath.posix;

  const mocked = {
    get sep() {
      return getActive().sep;
    },
    win32: mockPath.win32,
    posix: mockPath.posix,
    relative: (from: string, to: string) => getActive().relative(from, to),
    isAbsolute: (p: string) => getActive().isAbsolute(p),
    resolve: (...args: string[]) => getActive().resolve(...args),
    join: (...args: string[]) => getActive().join(...args),
    normalize: (p: string) => getActive().normalize(p),
    dirname: (p: string) => getActive().dirname(p),
    basename: (p: string) => getActive().basename(p),
    extname: (p: string) => getActive().extname(p),
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('fs', () => ({
  default: {
    promises: mocks.fsPromisesMock,
  },
  promises: mocks.fsPromisesMock,
}));

vi.mock('fs/promises', () => ({
  default: mocks.fsPromisesMock,
  ...mocks.fsPromisesMock,
}));

vi.mock('child_process', () => {
  return {
    spawn: mocks.mockSpawn,
    exec: vi.fn(),
    default: { spawn: mocks.mockSpawn, exec: vi.fn() },
  };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    isPackaged: false,
    on: vi.fn(),
    quit: vi.fn(),
    commandLine: {
      appendSwitch: vi.fn(),
    },
  },
  BrowserWindow: vi.fn(),
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('../../src/main/local-server.js', () => ({
  getServerPort: vi.fn(),
  getMimeType: vi.fn(),
  startLocalServer: vi.fn(),
  stopLocalServer: vi.fn(),
}));

vi.mock('../../src/core/database', () => ({
  isFileInLibrary: vi.fn(),
  closeDatabase: vi.fn(),
  getMediaDirectories: mocks.mockGetMediaDirectories,
}));

vi.mock('../../src/main/ipc/system-controller', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    registerSystemHandlers: actual.registerSystemHandlers,
  };
});

describe('Main Process IPC - open-in-vlc', () => {
  let openInVlcHandler: (event: any, filePath: string) => Promise<any>;
  const originalPlatform = process.platform;

  beforeAll(async () => {
    // Register system handlers directly
    await import('../../src/main/ipc/system-controller').then((mod) => {
      mod.registerSystemHandlers();
    });

    // Find the handler
    const handleCalls = (ipcMain.handle as unknown as Mock).mock.calls;
    const call = handleCalls.find((call: any[]) => call[0] === 'open-in-vlc');
    if (call) {
      openInVlcHandler = call[1];
    }
  });

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    // Default mocks
    mocks.mockRealpath.mockImplementation(async (p) => p);

    // Default allowed directories (covers both win/unix examples)
    mocks.mockGetMediaDirectories.mockResolvedValue([
      { path: 'C:\\', isActive: true },
      { path: '/home/user', isActive: true },
      { path: '/Users', isActive: true },
      { path: '/', isActive: true },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  it('should be registered', () => {
    expect(openInVlcHandler).toBeDefined();
  });

  it('should fail if VLC is not found on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    mocks.mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await openInVlcHandler({}, 'C:\\video.mp4');

    expect(result.success).toBe(true);
    expect(result.data.success).toBe(false);
    expect(result.data.message).toContain('VLC Media Player not found');
    expect(mocks.mockSpawn).not.toHaveBeenCalled();
  });

  it('should succeed if VLC is found on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });

    mocks.mockFsAccess.mockImplementation((path: any) =>
      path.includes('vlc.exe')
        ? Promise.resolve()
        : Promise.reject(new Error('ENOENT')),
    );

    const mockChild = { unref: vi.fn(), on: vi.fn() };
    mocks.mockSpawn.mockReturnValue(mockChild);

    const promise = openInVlcHandler({}, 'C:\\video.mp4');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data.success).toBe(true);
    expect(mocks.mockSpawn).toHaveBeenCalled();
    expect(mockChild.unref).toHaveBeenCalled();
  });

  it('should attempt to spawn "vlc" on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const mockChild = { unref: vi.fn(), on: vi.fn() };
    mocks.mockSpawn.mockReturnValue(mockChild);

    const promise = openInVlcHandler({}, '/home/user/video.mp4');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data.success).toBe(true);
    expect(mocks.mockSpawn).toHaveBeenCalledWith(
      'vlc',
      ['--', '/home/user/video.mp4'],
      expect.anything(),
    );
  });

  it('should use standard path on macOS if it exists', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mocks.mockFsAccess.mockImplementation((path: any) =>
      path === '/Applications/VLC.app/Contents/MacOS/VLC'
        ? Promise.resolve()
        : Promise.reject(new Error('ENOENT')),
    );

    const mockChild = { unref: vi.fn(), on: vi.fn() };
    mocks.mockSpawn.mockReturnValue(mockChild);

    const promise = openInVlcHandler({}, '/Users/video.mp4');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data.success).toBe(true);
    expect(mocks.mockSpawn).toHaveBeenCalledWith(
      '/Applications/VLC.app/Contents/MacOS/VLC',
      ['--', '/Users/video.mp4'],
      expect.anything(),
    );
  });

  it('should fallback to "vlc" on macOS if standard path does not exist', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    mocks.mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const mockChild = { unref: vi.fn(), on: vi.fn() };
    mocks.mockSpawn.mockReturnValue(mockChild);

    const promise = openInVlcHandler({}, '/Users/video.mp4');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.data.success).toBe(true);
    expect(mocks.mockSpawn).toHaveBeenCalledWith(
      'vlc',
      ['--', '/Users/video.mp4'],
      expect.anything(),
    );
  });

  it('should attach error listener to child process', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const mockOn = vi.fn();
    const mockChild = { unref: vi.fn(), on: mockOn };
    mocks.mockSpawn.mockReturnValue(mockChild);

    const promise = openInVlcHandler({}, '/home/user/video.mp4');
    await vi.runAllTimersAsync();
    await vi.runAllTimersAsync();
    await promise;

    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('should handle synchronous spawn errors', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    mocks.mockSpawn.mockImplementation(() => {
      throw new Error('Spawn failed');
    });

    const result = await openInVlcHandler({}, '/home/user/video.mp4');

    expect(result.success).toBe(true);
    expect(result.data.success).toBe(false);
    expect(result.data.message).toContain('Failed to launch VLC: Spawn failed');
  });
});
