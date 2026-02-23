// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaHandler } from '../../src/core/media-handler';
import { MediaService } from '../../src/core/media-service';
import { EventEmitter } from 'events';

// Hoist the mock implementation
const { MockWorkerClient, mockValidateFileAccess } = vi.hoisted(() => {
  return {
    MockWorkerClient: vi.fn(function () {
      return {
        init: vi.fn().mockResolvedValue(undefined),
        sendMessage: vi.fn().mockResolvedValue([]),
        terminate: vi.fn().mockResolvedValue(undefined),
      };
    }),
    mockValidateFileAccess: vi.fn(),
  };
});

// Mock access-validator
vi.mock('../../src/core/access-validator', () => ({
  validateFileAccess: mockValidateFileAccess,
  handleAccessCheck: vi.fn((res, access) => {
    if (!access.success) {
      if (!res.headersSent) res.status(access.statusCode).send(access.error);
      return true;
    }
    return false;
  }),
}));

// Mock dependencies
vi.mock('../../src/core/media-source');
vi.mock('../../src/core/worker-factory', () => ({
  WorkerFactory: {
    getWorkerPath: vi
      .fn()
      .mockResolvedValue({ path: '/mock/worker.js', options: {} }),
  },
}));

vi.mock('../../src/core/worker-client', () => ({
  WorkerClient: MockWorkerClient,
}));

// Mock media-utils to control isDrivePath
vi.mock('../../src/core/media-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media-utils')>();
  return {
    ...actual,
    isDrivePath: vi.fn((p) => p && p.startsWith('gdrive://')),
  };
});

// Mock child_process for spawn
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  const mockSpawn = vi.fn().mockReturnValue({
    stdout: { pipe: vi.fn(), on: vi.fn(), resume: vi.fn() },
    stderr: { on: vi.fn(), resume: vi.fn() }, // resume needed for readline
    on: vi.fn(),
    kill: vi.fn(),
  });
  return {
    ...actual,
    spawn: mockSpawn,
    default: {
      ...actual,
      spawn: mockSpawn,
    },
  };
});

// Mock fs/promises
vi.mock('fs/promises', async () => {
  return {
    default: {
      stat: vi.fn().mockResolvedValue({
        size: 1000,
        birthtime: new Date(),
        mtime: new Date(),
      }),
      access: vi.fn().mockResolvedValue(undefined),
    },
  };
});

describe('Coverage Boost - MediaHandler', () => {
  let handler: MediaHandler;
  let req: any;
  let res: any;

  beforeEach(() => {
    handler = new MediaHandler({
      ffmpegPath: '/usr/bin/ffmpeg',
      cacheDir: '/tmp',
    });
    req = {
      query: {},
      headers: {},
      path: '/test.mp4',
      on: vi.fn(),
    };
    res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      sendFile: vi.fn(),
      headersSent: false,
      end: vi.fn(),
    };
  });

  it('handleStreamRequest - handles Access Denied error', async () => {
    // Mock validateFileAccess to throw
    mockValidateFileAccess.mockRejectedValueOnce(new Error('Access denied'));

    req.query.file = '/test.mp4';
    await handler.handleStreamRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Access denied.');
  });

  it('handleStreamRequest - handles generic error', async () => {
    mockValidateFileAccess.mockRejectedValueOnce(new Error('Random error'));

    req.query.file = '/test.mp4';
    await handler.handleStreamRequest(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('Error initializing source');
  });

  it('handleStreamRequest - handles forced transcoding', async () => {
    // Mock validateFileAccess
    mockValidateFileAccess.mockResolvedValueOnce({
      success: true,
      path: '/test.mp4',
    });

    // Mock createMediaSource
    const sourceMock = {
      getFFmpegInput: vi.fn().mockResolvedValue('/test.mp4'),
    };
    const sourceSpy = vi.spyOn(
      await import('../../src/core/media-source'),
      'createMediaSource',
    );
    sourceSpy.mockReturnValue(sourceMock as any);

    req.query.file = '/test.mp4';
    req.query.transcode = 'true';

    await handler.handleStreamRequest(req, res);

    expect(res.set).toHaveBeenCalledWith({ 'Content-Type': 'video/mp4' });
    const childProcess = await import('child_process');
    expect(childProcess.spawn).toHaveBeenCalled();
  });

  it('serveRawStream - handles stream error', async () => {
    const mockSource = {
      getSize: vi.fn().mockResolvedValue(100),
      getMimeType: vi.fn().mockResolvedValue('video/mp4'),
      getStream: vi.fn().mockResolvedValue({
        stream: new EventEmitter(), // Mock stream
        length: 100,
      }),
      getFFmpegInput: vi.fn(),
    };

    // Inject pipe mock
    (mockSource.getStream as any).mockResolvedValue({
      stream: {
        pipe: vi.fn(),
        on: function (event: string, cb: any) {
          if (event === 'error') cb(new Error('Stream failed'));
        },
        destroy: vi.fn(),
      },
      length: 100,
    });

    // We need to bypass the private method protection or export serveRawStream
    // Fortunately serveRawStream is exported
    const { serveRawStream } = await import('../../src/core/media-handler');

    await serveRawStream(req, res, mockSource as any);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.end).toHaveBeenCalled();
  });

  it('getVideoDuration - handles drive paths and missing metadata', async () => {
    // Mock validateFileAccess to succeed for a drive path
    // Use gdrive:// protocol
    mockValidateFileAccess.mockResolvedValueOnce({
      success: true,
      path: 'gdrive://123',
    });

    // We need to mock getProvider to return a mock provider that returns partial metadata
    const factorySpy = vi.spyOn(
      await import('../../src/core/fs-provider-factory'),
      'getProvider',
    );
    const mockProvider = {
      getMetadata: vi.fn().mockResolvedValue({ size: 1000 }), // No duration
    };
    factorySpy.mockReturnValue(mockProvider as any);

    await await handler.serveMetadata(req, res, 'gdrive://123');

    expect(res.json).toHaveBeenCalledWith({ error: 'Duration not available' });
  });

  it('serveMetadata - handles missing ffmpeg path', async () => {
    // Create handler with no ffmpeg
    const noFfmpegHandler = new MediaHandler({
      ffmpegPath: null,
      cacheDir: '/tmp',
    });

    mockValidateFileAccess.mockResolvedValueOnce({
      success: true,
      path: '/local/file',
    });

    await noFfmpegHandler.serveMetadata(req, res, '/local/file');

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.send).toHaveBeenCalledWith('FFmpeg binary not found');
  });

  it('serveStaticFile - handles re-validation failure for local files', async () => {
    // Mock validateFileAccess to succeed
    mockValidateFileAccess.mockResolvedValueOnce({
      success: true,
      path: '/local/file',
    });

    // Mock authorizeFilePath to fail
    const authSpy = vi.spyOn(
      await import('../../src/core/security'),
      'authorizeFilePath',
    );
    authSpy.mockResolvedValueOnce({
      isAllowed: false,
      message: 'Re-validation failed',
    });

    await handler.serveStaticFile(req, res, '/local/file');

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Access denied.');
  });
});

describe('Coverage Boost - MediaService', () => {
  let service: MediaService;
  let repoMock: any;

  beforeEach(() => {
    // Manual mock for MediaRepository
    repoMock = {
      getMediaDirectories: vi.fn(),
      getSetting: vi.fn(),
      getCachedAlbums: vi.fn(),
      cacheAlbums: vi.fn(),
      getAllMetadataAndStats: vi.fn(),
      filterProcessingNeeded: vi.fn(),
      getPendingMetadata: vi.fn(),
      getAllMetadataVerification: vi.fn(),
      getMetadata: vi.fn(),
      bulkUpsertMetadata: vi.fn(),
    };
    service = new MediaService(repoMock);
    // Reset MockWorkerClient
    MockWorkerClient.mockClear();
  });

  it('scanDiskForAlbumsAndCache - handles getSetting error gracefully', async () => {
    repoMock.getMediaDirectories.mockResolvedValue([
      { path: '/data', isActive: true },
    ]);
    repoMock.getSetting.mockRejectedValue(new Error('DB Error'));

    // It should not throw, just log warn and proceed
    await expect(service.scanDiskForAlbumsAndCache()).resolves.toEqual([]);
  });

  it('scanDiskForAlbumsAndCache - handles getCachedAlbums error gracefully', async () => {
    repoMock.getMediaDirectories.mockResolvedValue([
      { path: '/data', isActive: true },
    ]);
    repoMock.getSetting.mockResolvedValue(null);
    repoMock.getCachedAlbums.mockRejectedValue(new Error('Cache Error'));

    await expect(service.scanDiskForAlbumsAndCache()).resolves.toEqual([]);
  });

  it('getAlbumsWithViewCounts - handles recursion', async () => {
    const albums = [
      {
        id: '1',
        name: 'Root',
        textures: [{ path: '/1.jpg', rating: 0 }],
        children: [
          {
            id: '2',
            name: 'Child',
            textures: [{ path: '/2.jpg', rating: 0 }],
            children: [],
          },
        ],
      },
    ];

    repoMock.getCachedAlbums.mockResolvedValue(albums);
    repoMock.getAllMetadataAndStats.mockResolvedValue([
      {
        file_path: '/1.jpg',
        view_count: 5,
        rating: 5,
        duration: 10,
      },
      {
        file_path: '/2.jpg',
        view_count: 10,
        rating: 4,
        duration: 20,
      },
    ]);

    const result = await service.getAlbumsWithViewCounts();

    expect(result[0].textures[0].viewCount).toBe(5);
    expect(result[0].textures[0].rating).toBe(5);
    expect(result[0].children![0].textures[0].viewCount).toBe(10);
  });

  it('extractAndSaveMetadata - skips existing successful metadata', async () => {
    // Setup repo mocks for both getAllMetadataVerification AND getMetadata
    const metadata = {
      '/test.mp4': {
        status: 'success',
        size: 1000,
        createdAt: '2023-01-01T00:00:00.000Z',
      },
    };
    repoMock.getAllMetadataVerification.mockResolvedValue(metadata);
    repoMock.getMetadata.mockResolvedValue(metadata);

    repoMock.bulkUpsertMetadata.mockResolvedValue({ success: true });

    // Mock fs.stat to return matching stats
    // Spy on default export
    const fsModule = await import('fs/promises');
    const fsSpy = vi.spyOn(fsModule.default, 'stat');
    fsSpy.mockResolvedValue({
      size: 1000,
      birthtime: new Date('2023-01-01T00:00:00.000Z'),
      mtime: new Date(),
    } as any);

    await service.extractAndSaveMetadata(['/test.mp4'], '/ffmpeg', {
      forceCheck: false,
    });

    // Should not call bulkUpsertMetadata because it skipped
    expect(repoMock.bulkUpsertMetadata).not.toHaveBeenCalled();
  });
});
