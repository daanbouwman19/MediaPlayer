import { describe, it, expect, vi, beforeEach, beforeAll, Mock } from 'vitest';
import { ipcMain } from 'electron';
import path from 'path';
import { Readable } from 'stream';

// Mock dependencies
const { mockFsPromises, mockCreateReadStream } = vi.hoisted(() => ({
  mockFsPromises: {
    access: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    realpath: vi.fn(async (p) => p),
  },
  mockCreateReadStream: vi.fn(),
}));

vi.mock('fs', () => ({
  default: {
    promises: mockFsPromises,
    createReadStream: mockCreateReadStream,
  },
  promises: mockFsPromises,
  createReadStream: mockCreateReadStream,
}));

vi.mock('fs/promises', () => ({
  default: mockFsPromises,
  ...mockFsPromises,
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
}));

vi.mock('../../src/main/database', () => ({
  getMediaDirectories: vi.fn(),
  initDatabase: vi.fn(),
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  closeDatabase: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
}));

vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn(),
  initDatabase: vi.fn(),
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  closeDatabase: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
}));

vi.mock('../../src/main/local-server', () => ({
  startLocalServer: vi.fn(),
  stopLocalServer: vi.fn(),
  getServerPort: vi.fn().mockReturnValue(0),
  getMimeType: vi.fn().mockReturnValue('image/jpeg'),
}));

// Mock heavy dependencies of media-handler to speed up tests
vi.mock('express', () => ({
  default: vi.fn(),
}));
vi.mock('../../src/core/media/analysis/media-analyzer.ts', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn().mockReturnValue({
      generateHeatmap: vi.fn(),
      getProgress: vi.fn(),
    }),
  },
}));
vi.mock('../../src/core/media/hls-handler.ts', () => ({
  serveHlsMaster: vi.fn(),
  serveHlsPlaylist: vi.fn(),
  serveHlsSegment: vi.fn(),
}));
vi.mock('../../src/core/media/thumbnail-handler.ts', () => ({
  serveThumbnail: vi.fn(),
}));

vi.mock('ffmpeg-static', () => ({
  default: '/mock/ffmpeg/path',
}));

describe('Security: load-file-as-data-url', () => {
  let handler: (event: any, ...args: any[]) => any;

  beforeAll(async () => {
    // Import media-controller to register the handlers
    const { registerMediaHandlers } =
      await import('../../src/main/ipc/media-controller');
    const { createTestMediaService } = await import('../utils/test-factory');
    const { service } = createTestMediaService();
    registerMediaHandlers(service);

    // Find the handler for 'load-file-as-data-url'
    const handleMock = ipcMain.handle as unknown as Mock;
    const call = handleMock.mock.calls.find(
      (c: any[]) => c[0] === 'load-file-as-data-url',
    );
    if (call) {
      handler = call[1];
    } else {
      throw new Error('Handler not found');
    }
  });

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('should allow access to files within allowed media directories', async () => {
    const fsPromises = await import('fs/promises');
    const db = await import('../../src/core/database/database');

    // Setup allowed directories
    const allowedDir = '/allowed/media';
    (db.getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: allowedDir, isActive: true },
    ]);

    const validFile = path.join(allowedDir, 'image.jpg');

    // Mock FS calls
    const mockPromises = fsPromises.default || fsPromises;
    (mockPromises.realpath as unknown as Mock).mockResolvedValue(validFile);
    (mockPromises.stat as unknown as Mock).mockResolvedValue({ size: 1000 });
    (mockPromises.readFile as unknown as Mock).mockResolvedValue(
      Buffer.from('test'),
    );

    // Mock createReadStream
    (mockCreateReadStream as unknown as Mock).mockReturnValue(
      Readable.from([Buffer.from('test')]),
    );

    const result = await handler(null, validFile);

    expect(result.data).toHaveProperty('type', 'data-url');
  });

  it('should deny access to files outside allowed media directories', async () => {
    const fsPromises = await import('fs/promises');
    const db = await import('../../src/core/database/database');

    // Setup allowed directories
    (db.getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: '/allowed/media', isActive: true },
    ]);

    const sensitiveFile = '/etc/passwd';

    // Mock FS to return the sensitive path only for itself
    const mockPromises = fsPromises.default || fsPromises;
    (mockPromises.realpath as unknown as Mock).mockImplementation(
      async (p: string) => {
        if (p.includes('passwd')) return sensitiveFile;
        return p;
      },
    );

    const result = await handler(null, sensitiveFile);

    expect(result.data).toEqual({
      type: 'error',
      message: expect.stringContaining('Access denied'),
    });
  });

  it('should deny path traversal attempts', async () => {
    const fsPromises = await import('fs/promises');
    const db = await import('../../src/core/database/database');

    const allowedDir = '/allowed/media';
    (db.getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: allowedDir, isActive: true },
    ]);

    // Attempt to break out of the directory
    const traversalPath = path.join(allowedDir, '../../etc/passwd');
    const resolvedPath = '/etc/passwd';

    // Mock FS
    const mockPromises = fsPromises.default || fsPromises;
    (mockPromises.realpath as unknown as Mock).mockImplementation(
      async (p: string) => {
        if (p.includes('passwd')) return resolvedPath;
        return p;
      },
    );

    const result = await handler(null, traversalPath);

    expect(result.data).toEqual({
      type: 'error',
      message: expect.stringContaining('Access denied'),
    });
  });

  it('should deny symlink traversal attacks', async () => {
    const fsPromises = await import('fs/promises');
    const db = await import('../../src/core/database/database');

    const allowedDir = '/allowed/media';
    (db.getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: allowedDir, isActive: true },
    ]);

    // Symlink inside allowed directory pointing outside
    const symlinkPath = path.join(allowedDir, 'secret_link');
    const targetPath = '/etc/passwd';

    // Mock realpath to return the sensitive target
    const mockPromises = fsPromises.default || fsPromises;
    (mockPromises.realpath as unknown as Mock).mockImplementation(
      async (p: string) => {
        if (p.includes('secret_link') || p.includes('passwd'))
          return targetPath;
        return p;
      },
    );

    const result = await handler(null, symlinkPath);

    expect(result.data).toEqual({
      type: 'error',
      message: expect.stringContaining('Access denied'),
    });
  });
});
