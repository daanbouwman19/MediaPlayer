import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';

// Mock electron at top level to ensure it's available
const mockElectron = vi.hoisted(() => ({
  app: {
    getPath: vi.fn().mockReturnValue('/user/data'),
    getAppPath: vi.fn().mockReturnValue('/app/asar'),
    isPackaged: false,
  },
  dialog: { showErrorBox: vi.fn() },
}));

vi.mock('electron', () => ({
  app: mockElectron.app,
  dialog: mockElectron.dialog,
}));

// Mock core database to intercept calls and avoid side effects
vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  initDatabase: vi.fn(),
  // We don't need to re-export others for this test
}));

describe('Main Process Database Initialization Paths', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalVitest = process.env.VITEST;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.VITEST = originalVitest;
  });

  it('should use correct worker path when packaged', async () => {
    // Set mock behavior for this test
    mockElectron.app.isPackaged = true;

    // Import module under test
    const { initDatabase } = await import('../../src/main/database');
    const { initDatabase: initCore } =
      await import('../../src/core/database/database');

    await initDatabase();

    // Verify initCore was called with a string path ending in database-worker.js
    expect(initCore).toHaveBeenCalledWith(
      expect.stringContaining('media_slideshow_stats.sqlite'),
      expect.stringMatching(/database-worker\.js$/),
      undefined,
      { onUnavailable: expect.any(Function) },
    );
  });

  it('should use correct worker URL in development', async () => {
    // Set mock behavior for this test
    mockElectron.app.isPackaged = false;

    // Mock environment to look like development
    process.env.NODE_ENV = 'development';
    process.env.VITEST = 'false';

    // Import module under test
    const { initDatabase } = await import('../../src/main/database');
    const { initDatabase: initCore } =
      await import('../../src/core/database/database');

    await initDatabase();

    // Verify initCore was called with a URL object
    expect(initCore).toHaveBeenCalledWith(
      expect.stringContaining('media_slideshow_stats.sqlite'),
      expect.any(URL),
      undefined,
      { onUnavailable: expect.any(Function) },
    );
  });

  it('should use correct worker path in test environment', async () => {
    // Set mock behavior for this test
    mockElectron.app.isPackaged = false;

    // Mock environment to look like test
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';

    // Import module under test
    const { initDatabase } = await import('../../src/main/database');
    const { initDatabase: initCore } =
      await import('../../src/core/database/database');

    await initDatabase();

    // Verify initCore was called with the TS worker path
    expect(initCore).toHaveBeenCalledWith(
      expect.stringContaining('media_slideshow_stats.sqlite'),
      expect.stringContaining('database-worker.ts'),
      undefined,
      { onUnavailable: expect.any(Function) },
    );
  });

  it('tells the user when the database worker cannot be restarted (F88)', async () => {
    const { initDatabase } = await import('../../src/main/database');
    const { initDatabase: initCore } =
      await import('../../src/core/database/database');

    await initDatabase();
    const options = vi.mocked(initCore).mock.calls[0]?.[3];
    options?.onUnavailable?.(new Error('database.js is unavailable: corrupt'));

    expect(mockElectron.dialog.showErrorBox).toHaveBeenCalledWith(
      'Media library unavailable',
      expect.stringContaining('database.js is unavailable: corrupt'),
    );
  });
});
