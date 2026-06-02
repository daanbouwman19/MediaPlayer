import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestMediaService } from '../utils/test-factory';
import { MediaRoutes } from '../../src/core/media/routes';
import {
  createMediaApp,
  serveHeatmapProgress,
  serveStaticFile,
} from '../../src/core/media/media-handler';
import { PassThrough } from 'stream';

// Dynamic mocks using vi.hoisted
const {
  mockValidateFileAccess,
  mockGetStream,
  mockIsDrivePath,
  mockGetProgress,
} = vi.hoisted(() => ({
  mockValidateFileAccess: vi.fn(),
  mockGetStream: vi.fn(),
  mockIsDrivePath: vi.fn(),
  mockGetProgress: vi.fn(),
}));

vi.mock('../../src/core/auth/access-validator', () => ({
  validateFileAccess: (path: string) => mockValidateFileAccess(path),
  handleAccessCheck: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/core/media/media-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media/media-utils')>();
  return {
    ...actual,
    isDrivePath: (p: string) => mockIsDrivePath(p),
    normalizeFilePath: (p: string) => p,
  };
});

vi.mock('../../src/core/media/media-source', () => ({
  createMediaSource: vi.fn().mockReturnValue({
    getSize: vi.fn().mockResolvedValue(100),
    getMimeType: vi.fn().mockResolvedValue('video/mp4'),
    getStream: (...args: any[]) => mockGetStream(...args),
    getFFmpegInput: vi.fn().mockResolvedValue('/mocked/path'),
  }),
}));

vi.mock('../../src/core/media/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn().mockReturnValue({
      setCacheDir: vi.fn(),
      generateHeatmap: vi.fn().mockResolvedValue([]),
      getProgress: (p: string) => mockGetProgress(p),
    }),
  },
}));

vi.mock('../../src/core/network/rate-limiter', () => ({
  createRateLimiter: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/core/auth/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/auth/security')>();
  return {
    ...actual,
    authorizeFilePath: vi
      .fn()
      .mockResolvedValue({ isAllowed: true, realPath: '/mocked/path' }),
  };
});

describe('MediaHandler Extra Coverage', () => {
  const { service } = createTestMediaService();
  const options = {
    ffmpegPath: '/usr/bin/ffmpeg',
    cacheDir: '/tmp/cache',
    mediaService: service,
  };

  let req: any;
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateFileAccess.mockResolvedValue({
      success: true,
      path: '/mocked/path',
    });

    // Default stream mock
    const pass = new PassThrough();
    pass.end('data');
    mockGetStream.mockResolvedValue({
      stream: pass,
      length: 100,
    });

    mockIsDrivePath.mockReturnValue(false);
    mockGetProgress.mockReturnValue(null);

    req = { query: {}, headers: {}, path: '/path' };
    res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      json: vi.fn(),
      sendFile: vi.fn(),
      headersSent: false,
      set: vi.fn().mockReturnThis(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serveHeatmapProgress returns null when no job', async () => {
    mockGetProgress.mockReturnValue(null);
    await serveHeatmapProgress(req, res, '/file.mp4');
    expect(res.json).toHaveBeenCalledWith({ progress: null });
  });

  it('serveHeatmapProgress returns progress when job exists', async () => {
    mockGetProgress.mockReturnValue(50);
    await serveHeatmapProgress(req, res, '/file.mp4');
    expect(res.json).toHaveBeenCalledWith({ progress: 50 });
  });

  it('serveStaticFile serves raw stream for Drive files', async () => {
    mockIsDrivePath.mockReturnValue(true);

    await serveStaticFile(req, res, '/file.mp4');

    // Should NOT use sendFile
    expect(res.sendFile).not.toHaveBeenCalled();
    // Should call serveRawStream -> sets headers
    expect(res.status).toHaveBeenCalledWith(206);
  });

  it('STREAM route handles Access denied from source', async () => {
    mockIsDrivePath.mockReturnValue(true);

    const app = createMediaApp(options);
    mockGetStream.mockRejectedValue(new Error('Access denied'));

    const res = await request(app)
      .get(MediaRoutes.STREAM)
      .query({ file: 'video.mp4' });

    expect(res.status).toBe(403);
    expect(res.text).toBe('Access denied.');
  });

  it('STREAM route handles other errors from source', async () => {
    mockIsDrivePath.mockReturnValue(true);

    const app = createMediaApp(options);
    mockGetStream.mockRejectedValue(new Error('Random Error'));

    const res = await request(app)
      .get(MediaRoutes.STREAM)
      .query({ file: 'video.mp4' });

    expect(res.status).toBe(500);
    expect(res.text).toBe('Error initializing source');
  });

  it('createMediaApp HEATMAP route executes successfully', async () => {
    const app = createMediaApp(options);
    const res = await request(app)
      .get(MediaRoutes.HEATMAP)
      .query({ file: 'video.mp4' });
    expect(res.status).toBe(200);
  });

  it('createMediaApp HEATMAP route returns 400 when file param is missing', async () => {
    const app = createMediaApp(options);
    const res = await request(app).get(MediaRoutes.HEATMAP);
    expect(res.status).toBe(400);
    expect(res.text).toBe('Missing file parameter');
  });

  it('createMediaApp Static file route handles Access denied error', async () => {
    const app = createMediaApp(options);
    mockValidateFileAccess.mockRejectedValue(
      new Error('Access denied by policy'),
    );
    const res = await request(app).get('/some/file.mp4');
    expect(res.status).toBe(403);
    expect(res.text).toBe('Access denied.');
  });
});
