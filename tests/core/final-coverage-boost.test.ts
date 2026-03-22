// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';

// --- Mocks Setup ---

const {
  mockDbInstance,
  mockStatement,
  mockDatabaseConstructor,
  mockSpawnProcess,
  mockWorkerClientInstance,
  mockMediaSource,
  mockValidateFileAccess,
  mockHandleAccessCheck,
} = vi.hoisted(() => {
  const mockStatement = {
    run: vi.fn(),
    all: vi.fn(() => []),
    get: vi.fn(),
  };

  const mockDbInstance = {
    pragma: vi.fn(),
    prepare: vi.fn(() => mockStatement),
    transaction: vi.fn((fn: any) => fn),
    close: vi.fn(),
  };

  const mockDatabaseConstructor = vi.fn();

  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const mockSpawnProcess: any = {
    stdout: { pipe: vi.fn(), on: vi.fn() },
    stderr: { pipe: vi.fn(), on: vi.fn() },
    kill: vi.fn(),
    on: vi.fn((event, listener) => {
      listeners[event] = listeners[event] || [];
      listeners[event].push(listener);
      return mockSpawnProcess;
    }),
    emit: (event: string, ...args: any[]) => {
      if (listeners[event]) {
        listeners[event].forEach((fn: any) => fn(...args));
      }
    },
  };

  const mockWorkerClientInstance = {
    init: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue([]),
    terminate: vi.fn(),
  };

  const mockStream = {
    pipe: vi.fn((dest) => dest),
    on: vi.fn(),
    destroy: vi.fn(),
  };

  const mockMediaSource = {
    getSize: vi.fn().mockResolvedValue(100),
    getMimeType: vi.fn().mockResolvedValue('video/mp4'),
    getStream: vi.fn().mockResolvedValue({ stream: mockStream, length: 100 }),
    getFFmpegInput: vi.fn().mockResolvedValue('/file.mp4'),
  };

  const mockValidateFileAccess = vi.fn();
  const mockHandleAccessCheck = vi.fn();

  return {
    mockDbInstance,
    mockStatement,
    mockDatabaseConstructor,
    mockSpawnProcess,
    mockWorkerClientInstance,
    mockMediaSource,
    mockStream,
    mockValidateFileAccess,
    mockHandleAccessCheck,
  };
});

// 1. Mock Database
vi.mock('better-sqlite3', () => {
  return {
    default: mockDatabaseConstructor,
  };
});

// 2. Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    rm: vi.fn(),
  },
  stat: vi.fn(),
}));

// 3. Mock worker_threads
vi.mock('worker_threads', () => {
  const parentPort = {
    on: vi.fn(),
    postMessage: vi.fn(),
  };
  return {
    parentPort,
    default: { parentPort },
    __esModule: true,
  };
});

// 4. Mock child_process
vi.mock('child_process', () => {
  return {
    spawn: vi.fn(() => mockSpawnProcess),
    default: { spawn: vi.fn(() => mockSpawnProcess) },
    __esModule: true,
  };
});

// 5. Mock access-validator
vi.mock('../../src/core/access-validator', () => ({
  validateFileAccess: mockValidateFileAccess,
  handleAccessCheck: mockHandleAccessCheck,
}));

// 6. Mock worker-client
vi.mock('../../src/core/worker-client', () => {
  return {
    WorkerClient: class {
      init = mockWorkerClientInstance.init;
      sendMessage = mockWorkerClientInstance.sendMessage;
      terminate = mockWorkerClientInstance.terminate;
    },
  };
});

// 7. Mock media-source
vi.mock('../../src/core/media-source', () => ({
  createMediaSource: vi.fn(() => mockMediaSource),
}));

// 8. Mock readline
vi.mock('readline', () => {
  const createInterface = vi.fn(() => ({
    on: vi.fn(),
    close: vi.fn(),
  }));
  return {
    createInterface,
    default: { createInterface },
    __esModule: true,
  };
});

// 9. Mock media-utils (partial)
vi.mock('../../src/core/media-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media-utils')>();
  return {
    ...actual,
    isDrivePath: vi.fn((p) => actual.isDrivePath(p)),
  };
});

// 10. Mock media-analyzer
vi.mock('../../src/core/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: () => ({
      generateHeatmap: vi.fn().mockRejectedValue(new Error('Heatmap Fail')),
      setCacheDir: vi.fn(),
    }),
  },
}));

// Import modules
import * as dbWorker from '../../src/core/database-worker';
import * as mediaService from '../../src/core/media-service';
import * as mediaHandler from '../../src/core/media-handler';
import * as mediaUtils from '../../src/core/media-utils';
import { MediaRepository } from '../../src/core/repositories/media-repository';

describe('Final Coverage Boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock Db behavior
    mockDatabaseConstructor.mockImplementation(function () {
      return mockDbInstance;
    });
    mockDbInstance.prepare.mockReturnValue(mockStatement);
    mockStatement.run.mockReset();
    mockStatement.all.mockReset();
    mockStatement.all.mockReturnValue([]);
    mockStatement.get.mockReset();

    // Default valid access
    mockValidateFileAccess.mockResolvedValue({
      success: true,
      path: '/file.mp4',
    });
    mockHandleAccessCheck.mockReturnValue(false);

    // Default fs.stat
    vi.mocked(fs.stat).mockResolvedValue({
      size: 100,
      mtime: new Date(),
      birthtime: new Date(),
    } as any);

    // Default worker client
    mockWorkerClientInstance.init.mockResolvedValue(undefined);
    mockWorkerClientInstance.sendMessage.mockResolvedValue([]);
    mockWorkerClientInstance.terminate.mockResolvedValue(undefined);

    // Default media-utils
    if (vi.isMockFunction(mediaUtils.isDrivePath)) {
      vi.mocked(mediaUtils.isDrivePath).mockReturnValue(false);
    }
  });

  afterEach(() => {
    dbWorker.closeDatabase();
    vi.restoreAllMocks();
  });

  // --- Database Worker Coverage ---
  describe('Database Worker Edge Cases', () => {
    it('generateFileId: handles non-ENOENT fs.stat error', async () => {
      // Must init DB first because upsertMetadata checks DB state
      dbWorker.initDatabase(':memory:');

      const err: any = new Error('Permission denied');
      err.code = 'EACCES';
      vi.mocked(fs.stat).mockRejectedValue(err);

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await dbWorker.upsertMetadata({ filePath: '/test/file.mp4' });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('recordMediaView: handles unique constraint violation by falling back', async () => {
      const initRes = dbWorker.initDatabase(':memory:');
      if (!initRes.success) throw new Error(`Init failed: ${initRes.error}`);

      mockStatement.run.mockClear();

      // We need to queue enough mock implementations to cover potential extra calls or retries
      // sequence: insert -> updatePath -> updateFallback
      mockStatement.run
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          const e: any = new Error('Constraint');
          e.code = 'SQLITE_CONSTRAINT_UNIQUE';
          throw e;
        })
        .mockImplementationOnce(() => {});

      await dbWorker.recordMediaView('/test/view.mp4');

      expect(mockStatement.run).toHaveBeenCalledTimes(3);
    });

    it('recordMediaView: throws on non-constraint error', async () => {
      const initRes = dbWorker.initDatabase(':memory:');
      if (!initRes.success) throw new Error(`Init failed: ${initRes.error}`);

      mockStatement.run.mockClear();

      mockStatement.run
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw new Error('Random DB Error');
        });

      const result = await dbWorker.recordMediaView('/test/view.mp4');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Random DB Error');
    });

    it('initDatabase: handles initialization failure', () => {
      // Use standard function for constructor mock
      mockDatabaseConstructor.mockImplementationOnce(function () {
        throw new Error('Init Fail');
      } as any);

      const result = dbWorker.initDatabase(':memory:');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Init Fail');
    });

    it('closeDatabase: handles error', () => {
      dbWorker.initDatabase(':memory:');
      mockDbInstance.close.mockImplementationOnce(() => {
        throw new Error('Close Fail');
      });
      const result = dbWorker.closeDatabase();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Close Fail');
    });

    it('addMediaDirectory: handles error', () => {
      dbWorker.initDatabase(':memory:');
      mockStatement.run.mockImplementationOnce(() => {
        throw new Error('Add Fail');
      });
      const result = dbWorker.addMediaDirectory({ path: '/foo' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Add Fail');
    });

    it('getMediaDirectories: handles error', () => {
      dbWorker.initDatabase(':memory:');
      mockStatement.all.mockImplementationOnce(() => {
        throw new Error('Get Fail');
      });
      const result = dbWorker.getMediaDirectories();
      expect(result.success).toBe(false);
      expect(result.error).toBe('Get Fail');
    });

    it('getMetadata: returns empty object for empty array', async () => {
      dbWorker.initDatabase(':memory:');
      const result = await dbWorker.getMetadata([]);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({});
    });

    it('getMetadata: handles large batches (900+)', async () => {
      dbWorker.initDatabase(':memory:');
      mockStatement.all.mockClear(); // Clear init calls

      const largeBatch = Array.from({ length: 905 }, (_, i) => `/file${i}.mp4`);
      mockStatement.all.mockReturnValue([]);

      const result = await dbWorker.getMetadata(largeBatch);
      expect(result.success).toBe(true);
      // 2 calls for ID generation (check), 2 calls for metadata fetch = 4
      expect(mockStatement.all.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  // --- Media Service Coverage ---
  describe('Media Service Edge Cases', () => {
    it('scanDiskForAlbumsAndCache: handles token parse error', async () => {
      // Mock MediaRepository.prototype methods
      const getSettingSpy = vi
        .spyOn(MediaRepository.prototype, 'getSetting')
        .mockResolvedValue('invalid-json');
      const getDirsSpy = vi
        .spyOn(MediaRepository.prototype, 'getMediaDirectories')
        .mockResolvedValue([{ path: '/dir', isActive: true }] as any);
      const cacheSpy = vi
        .spyOn(MediaRepository.prototype, 'cacheAlbums')
        .mockResolvedValue();

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await mediaService.scanDiskForAlbumsAndCache();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch google tokens'),
        expect.any(Error),
      );

      getSettingSpy.mockRestore();
      getDirsSpy.mockRestore();
      cacheSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    it('extractAndSaveMetadata: optimization skips if metadata matches', async () => {
      const getMetaSpy = vi
        .spyOn(MediaRepository.prototype, 'getMetadata')
        .mockResolvedValue({
          '/file.mp4': {
            status: 'success',
            size: 100,
            createdAt: '2023-01-01T00:00:00.000Z',
          },
        });

      vi.mocked(fs.stat).mockResolvedValue({
        size: 100,
        birthtime: { toISOString: () => '2023-01-01T00:00:00.000Z' },
      } as any);

      const upsertSpy = vi.spyOn(
        MediaRepository.prototype,
        'bulkUpsertMetadata',
      );

      await mediaService.extractAndSaveMetadata(['/file.mp4'], 'ffmpeg', {
        forceCheck: false,
      });

      expect(upsertSpy).not.toHaveBeenCalled();
      getMetaSpy.mockRestore();
      upsertSpy.mockRestore();
    });

    it('extractAndSaveMetadata: skips drive paths', async () => {
      vi.mocked(mediaUtils.isDrivePath).mockReturnValue(true);
      const upsertSpy = vi.spyOn(
        MediaRepository.prototype,
        'bulkUpsertMetadata',
      );

      await mediaService.extractAndSaveMetadata(
        ['gdrive://file.mp4'],
        'ffmpeg',
      );

      expect(upsertSpy).not.toHaveBeenCalled();
    });
  });

  // --- Media Handler Coverage ---
  describe('Media Handler Edge Cases', () => {
    it('sendAccessError: does not send if headers sent', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: false,
        statusCode: 403,
        error: 'Denied',
      });
      // Mock handleAccessCheck implementation for this test to replicate behavior
      mockHandleAccessCheck.mockImplementation((res, access) => {
        if (!access.success) {
          if (!res.headersSent)
            res.status(access.statusCode).send(access.error);
          return true;
        }
        return false;
      });

      const req = { query: { file: '/test.mp4' } } as any;
      const res = {
        headersSent: true, // Key: Headers already sent
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      const handler = new mediaHandler.MediaHandler({
        ffmpegPath: 'ffmpeg',
        cacheDir: '/tmp',
      });
      await handler.handleStreamRequest(req, res);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });

    it('tryServeDirectFile: handles sendFile error', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const req = {
        query: { file: '/local/file.mp4' },
        on: vi.fn(),
        headers: {},
      } as any;
      const res = {
        sendFile: vi.fn(() => {
          throw new Error('SendFile Failed');
        }),
        status: vi.fn().mockReturnThis(),
        set: vi.fn(),
        send: vi.fn(),
        end: vi.fn(),
      } as any;

      const handler = new mediaHandler.MediaHandler({
        ffmpegPath: 'ffmpeg',
        cacheDir: '/tmp',
      });

      await handler.handleStreamRequest(req, res);

      expect(res.sendFile).toHaveBeenCalled();
      // Should fall through to raw stream (status 206)
      expect(res.status).toHaveBeenCalledWith(206);
    });

    it('processStream: handles missing ffmpegPath when forced', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/file.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const req = { query: { file: '/file.mp4', transcode: 'true' } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      // Force ffmpegPath to null
      const handler = new mediaHandler.MediaHandler({
        ffmpegPath: null,
        cacheDir: '/tmp',
      });
      await handler.handleStreamRequest(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('FFmpeg binary not found');
    });

    it('serveTranscodedStream: handles spawn error', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/file.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const req = {
        query: { file: '/file.mp4', transcode: 'true' },
        on: vi.fn(),
      } as any;
      const res = {
        set: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      const handler = new mediaHandler.MediaHandler({
        ffmpegPath: 'ffmpeg',
        cacheDir: '/tmp',
      });

      // Capture console error
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Start request
      await handler.handleStreamRequest(req, res);

      // Emit error on the mock process
      await new Promise((r) => setTimeout(r, 0));
      mockSpawnProcess.emit('error', new Error('Spawn failed'));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Transcode] Spawn Error'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('serveMetadata: handles missing ffmpegPath', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);
      // Mock isDrivePath -> false

      const req = { query: { file: '/local.mp4' } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
        json: vi.fn(),
      } as any;

      const handler = new mediaHandler.MediaHandler({
        ffmpegPath: null,
        cacheDir: '/tmp',
      });
      await handler.serveMetadata(req, res, '/local.mp4');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('FFmpeg binary not found');
    });

    it('serveHeatmap: handles error', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const req = { query: { file: '/local.mp4' } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      const handler = new mediaHandler.MediaHandler({
        ffmpegPath: 'ffmpeg',
        cacheDir: '/tmp',
      });
      await handler.serveHeatmap(req, res, '/local.mp4');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Heatmap generation failed');
    });
  });
});
