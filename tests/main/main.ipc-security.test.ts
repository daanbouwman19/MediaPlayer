import { describe, it, expect, vi, beforeEach, beforeAll, Mock } from 'vitest';
import { ipcMain } from 'electron';

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    realpath: vi.fn(),
  },
}));

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
  shell: {
    openExternal: vi.fn(),
  },
}));

// Mock local server and database
vi.mock('../../src/main/local-server.js', () => ({
  getServerPort: vi.fn(),
  getMimeType: vi.fn(),
  startLocalServer: vi.fn(),
  stopLocalServer: vi.fn(),
}));

vi.mock('../../src/main/database', () => ({
  initDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/core/database', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn(),
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  upsertMetadata: vi.fn(),
  setRating: vi.fn(),
  getMetadata: vi.fn(),
  closeDatabase: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
}));

// Mock heavy dependencies of media-handler to speed up tests (media-controller imports media-handler)
vi.mock('express', () => ({
  default: vi.fn(),
}));
vi.mock('../../src/core/analysis/media-analyzer.ts', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn().mockReturnValue({
      generateHeatmap: vi.fn(),
      getProgress: vi.fn(),
    }),
  },
}));
vi.mock('../../src/core/hls-handler.ts', () => ({
  serveHlsMaster: vi.fn(),
  serveHlsPlaylist: vi.fn(),
  serveHlsSegment: vi.fn(),
}));
vi.mock('../../src/core/thumbnail-handler.ts', () => ({
  serveThumbnail: vi.fn(),
}));

// Mock security module
vi.mock('../../src/core/security', () => ({
  authorizeFilePath: vi.fn(),
  filterAuthorizedPaths: vi.fn(),
}));

vi.mock('electron-log/main.js', () => ({
  default: {
    initialize: vi.fn(),
    errorHandler: { startCatching: vi.fn() },
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    verbose: vi.fn(),
    transports: {
      file: {
        resolvePath: vi.fn(),
        level: 'info',
      },
    },
  },
}));

vi.mock('ffmpeg-static', () => ({
  default: '/mock/ffmpeg/path',
}));

describe('main.js IPC Security', () => {
  const handlers: { [key: string]: (event: any, ...args: any[]) => any } = {};

  beforeAll(async () => {
    // Import controllers to register the handlers
    const { registerMediaHandlers } =
      await import('../../src/main/ipc/media-controller');
    const { registerDatabaseHandlers } =
      await import('../../src/main/ipc/database-controller');

    const { createTestMediaService } = await import('../utils/test-factory');
    const { service } = createTestMediaService();

    registerMediaHandlers(service);
    registerDatabaseHandlers();

    // Collect all registered handlers
    const handleMock = ipcMain.handle as unknown as Mock;
    handleMock.mock.calls.forEach((call: any[]) => {
      handlers[call[0]] = call[1];
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup authorizeFilePath default to deny
    const security = await import('../../src/core/security');
    (security.authorizeFilePath as unknown as Mock).mockResolvedValue({
      isAllowed: false,
      message: 'Access denied',
    });
  });

  it('should deny record-media-view for unauthorized file', async () => {
    const unauthorizedPath = '/etc/passwd';
    const db = await import('../../src/core/database');
    const handler = handlers['record-media-view'];

    expect(handler).toBeDefined();

    // Expecting rejection (access denied) or at least not calling db
    // Currently (vulnerable) it will not reject and will call db
    const result = await handler(null, unauthorizedPath);
    expect(result).toEqual({ success: false, error: 'Access denied' });

    expect(db.recordMediaView).not.toHaveBeenCalled();
  });

  it('should allow record-media-view for authorized file', async () => {
    const authorizedPath = '/media/movie.mp4';
    const security = await import('../../src/core/security');
    (security.authorizeFilePath as unknown as Mock).mockResolvedValue({
      isAllowed: true,
    });
    const db = await import('../../src/core/database');
    const handler = handlers['record-media-view'];

    await handler(null, authorizedPath);
    expect(db.recordMediaView).toHaveBeenCalledWith(authorizedPath);
  });

  it('should allow record-media-view for gdrive file', async () => {
    const gdrivePath = 'gdrive://12345';
    const db = await import('../../src/core/database');
    const handler = handlers['record-media-view'];

    await handler(null, gdrivePath);
    expect(db.recordMediaView).toHaveBeenCalledWith(gdrivePath);
  });

  it('should filter unauthorized paths in get-media-view-counts', async () => {
    const paths = ['/media/allowed.mp4', '/etc/passwd', 'gdrive://123'];
    const security = await import('../../src/core/security');
    (security.filterAuthorizedPaths as unknown as Mock).mockResolvedValue([
      '/media/allowed.mp4',
      'gdrive://123',
    ]);

    const db = await import('../../src/core/database');
    const handler = handlers['get-media-view-counts'];

    await handler(null, paths);

    expect(db.getMediaViewCounts).toHaveBeenCalledWith(
      expect.arrayContaining(['/media/allowed.mp4', 'gdrive://123']),
    );
    expect(db.getMediaViewCounts).toHaveBeenCalledWith(
      expect.not.arrayContaining(['/etc/passwd']),
    );
  });

  it('should deny db:upsert-metadata for unauthorized file', async () => {
    const unauthorizedPath = '/etc/passwd';
    const db = await import('../../src/core/database');
    const handler = handlers['db:upsert-metadata'];

    expect(handler).toBeDefined();

    const result = await handler(null, {
      filePath: unauthorizedPath,
      metadata: {},
    });
    expect(result).toEqual({ success: false, error: 'Access denied' });
    expect(db.upsertMetadata).not.toHaveBeenCalled();
  });
});
