import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMediaRoutes } from '../../src/server/routes/media.routes';
import { errorHandler } from '../../src/server/middleware/error-handler';
import * as database from '../../src/core/database';
import * as security from '../../src/core/security';
import * as mediaHandler from '../../src/core/media-handler';
import * as mediaSource from '../../src/core/media-source';
import { createTestMediaService } from '../utils/test-factory';

type TestAppResult = {
  app: express.Express;
  mediaHandler: {
    serveMetadata: ReturnType<typeof vi.fn>;
    serveThumbnail: ReturnType<typeof vi.fn>;
    serveHeatmap: ReturnType<typeof vi.fn>;
    serveHeatmapProgress: ReturnType<typeof vi.fn>;
    serveHlsMaster: ReturnType<typeof vi.fn>;
    serveHlsPlaylist: ReturnType<typeof vi.fn>;
    serveHlsSegment: ReturnType<typeof vi.fn>;
    serveStaticFile: ReturnType<typeof vi.fn>;
  };
  transcodeState: { current: number };
};

const { MockMediaHandler } = vi.hoisted(() => {
  class MockMediaHandler {
    serveMetadata = vi.fn((_req, res) => res.status(200).send('ok'));
    serveThumbnail = vi.fn((_req, res) => res.status(200).send('ok'));
    serveHeatmap = vi.fn((_req, res) => res.status(200).send('ok'));
    serveHeatmapProgress = vi.fn((_req, res) => res.status(200).send('ok'));
    serveHlsMaster = vi.fn((_req, res) => res.status(200).send('ok'));
    serveHlsPlaylist = vi.fn((_req, res) => res.status(200).send('ok'));
    serveHlsSegment = vi.fn((_req, res) => res.status(200).send('ok'));
    serveStaticFile = vi.fn((_req, res) => res.status(200).send('ok'));
  }

  return { MockMediaHandler };
});

vi.mock('../../src/core/database', () => ({
  getAllMetadataAndStats: vi.fn(),
  getMediaViewCounts: vi.fn(),
  getMetadata: vi.fn(),
  getRecentlyPlayed: vi.fn(),
  recordMediaView: vi.fn(),
  setRating: vi.fn(),
  upsertMetadata: vi.fn(),
}));

vi.mock('../../src/core/security', () => ({
  authorizeFilePath: vi.fn(),
  filterAuthorizedPaths: vi.fn(),
}));

vi.mock('../../src/core/media-handler', () => ({
  MediaHandler: MockMediaHandler,
  serveRawStream: vi.fn(),
  serveTranscodedStream: vi.fn(),
  validateFileAccess: vi.fn(),
}));

vi.mock('../../src/core/media-source', () => ({
  createMediaSource: vi.fn(),
}));

const createLimiter =
  () =>
  (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next();

const createTestApp = (ffmpegPath: string | null): TestAppResult => {
  const app = express();
  app.use(express.json());

  const { service } = createTestMediaService();
  const handler = new (mediaHandler.MediaHandler as any)({
    ffmpegPath,
    cacheDir: '/tmp',
    mediaService: service,
  });

  const transcodeState = { current: 0 };

  app.use(
    createMediaRoutes({
      limiters: {
        readLimiter: createLimiter(),
        writeLimiter: createLimiter(),
        fileLimiter: createLimiter(),
        authLimiter: createLimiter(),
        basicAuthLimiter: createLimiter(),
        streamLimiter: createLimiter(),
      },
      mediaHandler: handler as any,
      transcodeState,
      ffmpegPath,
    }),
  );
  app.use(errorHandler);

  app.use((err: any, _req: express.Request, res: express.Response) => {
    res.status(500).send(err.message || 'Internal Server Error Fallback');
  });

  return { app, mediaHandler: handler, transcodeState };
};

describe('Media routes additional coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(security.authorizeFilePath).mockResolvedValue({
      isAllowed: true,
      realPath: '/file.mp4',
    });
    vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
      success: true,
      path: '/file.mp4',
    });
    vi.mocked(mediaSource.createMediaSource).mockReturnValue({
      filePath: '/file.mp4',
    } as any);
  });

  it('GET /api/media/all returns metadata', async () => {
    vi.mocked(database.getAllMetadataAndStats).mockResolvedValue([] as any);
    const { app } = createTestApp('ffmpeg');

    const res = await request(app).get('/api/media/all');

    expect(res.status).toBe(200);
    expect(database.getAllMetadataAndStats).toHaveBeenCalled();
  });

  it('GET /api/stream returns 500 when ffmpeg is missing', async () => {
    const { app } = createTestApp(null);

    const res = await request(app)
      .get('/api/stream')
      .query({ file: '/file.mp4', transcode: 'true' });

    expect(res.status).toBe(500);
    expect(res.text).toBe('FFmpeg not found');
  });

  it('GET /api/stream cleans up on transcode errors', async () => {
    vi.mocked(mediaHandler.serveTranscodedStream).mockImplementation(() =>
      Promise.reject(new Error('Transcode failed')),
    );
    const { app, transcodeState } = createTestApp('ffmpeg');

    const res = await request(app)
      .get('/api/stream')
      .query({ file: '/file.mp4', transcode: 'true' });

    expect(res.status).toBe(500);
    expect(transcodeState.current).toBe(0);
  });

  it('GET /api/video/heatmap/status returns 400 without file', async () => {
    const { app } = createTestApp('ffmpeg');

    const res = await request(app).get('/api/video/heatmap/status');

    expect(res.status).toBe(400);
  });

  it('GET /api/hls/master.m3u8 returns 400 without file', async () => {
    const { app } = createTestApp('ffmpeg');

    const res = await request(app).get('/api/hls/master.m3u8');

    expect(res.status).toBe(400);
  });

  it('GET /api/hls/playlist.m3u8 returns 400 without file', async () => {
    const { app } = createTestApp('ffmpeg');

    const res = await request(app).get('/api/hls/playlist.m3u8');

    expect(res.status).toBe(400);
  });

  it('GET /api/hls/:segment calls handler with segment name', async () => {
    const { app, mediaHandler: handler } = createTestApp('ffmpeg');

    const res = await request(app)
      .get('/api/hls/segment-1.ts')
      .query({ file: '/file.mp4' });

    expect(res.status).toBe(200);
    expect(handler.serveHlsSegment).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      '/file.mp4',
      'segment-1.ts',
    );
  });
  it('POST /api/media/views returns 400 for invalid body', async () => {
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .post('/api/media/views')
      .send({ filePaths: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('POST /api/media/views returns 400 when exceeding batch limit', async () => {
    const { app } = createTestApp('ffmpeg');
    const filePaths = Array(2000).fill('/path.mp4');
    const res = await request(app).post('/api/media/views').send({ filePaths });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Batch size exceeds limit');
  });

  it('POST /api/media/views returns counts on success', async () => {
    vi.mocked(security.filterAuthorizedPaths).mockResolvedValue(['/file.mp4']);
    vi.mocked(database.getMediaViewCounts).mockResolvedValue({
      '/file.mp4': 5,
    });
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .post('/api/media/views')
      .send({ filePaths: ['/file.mp4'] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ '/file.mp4': 5 });
  });

  it('POST /api/media/rate returns 400 for invalid rating', async () => {
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .post('/api/media/rate')
      .send({ filePath: '/file.mp4', rating: '5' }); // string instead of number
    expect(res.status).toBe(400);
  });

  it('POST /api/media/metadata returns 400 for missing metadata', async () => {
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .post('/api/media/metadata')
      .send({ filePath: '/file.mp4' }); // missing metadata
    expect(res.status).toBe(400);
  });

  it('POST /api/media/metadata/batch returns 400 for invalid array', async () => {
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .post('/api/media/metadata/batch')
      .send({ filePaths: [123] });
    expect(res.status).toBe(400);
  });

  it('GET /api/stream returns 403 on Access denied from validateFileAccess', async () => {
    vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
      success: false,
      statusCode: 403,
      error: 'Access denied',
    });
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .get('/api/stream')
      .query({ file: '/blocked.mp4' });
    expect(res.status).toBe(403);
    expect(res.text).toBe('Access denied');
  });

  it('GET /api/serve handles success correctly', async () => {
    vi.mocked(mediaHandler.serveRawStream).mockImplementation(
      (_req, res: any) => {
        res.status(200).send('ok');
        return Promise.resolve();
      },
    );
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .get('/api/serve')
      .query({ path: '/file.mp4' });
    expect(res.status).toBe(200);
    expect(mediaHandler.serveRawStream).toHaveBeenCalled();
  });

  it('GET /api/serve handles validation failure', async () => {
    vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
      success: false,
      statusCode: 404,
      error: 'Not found',
    });
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .get('/api/serve')
      .query({ path: '/bad.mp4' });
    expect(res.status).toBe(404);
    expect(res.text).toBe('Not found');
  });

  it('GET /api/serve handles general exceptions with 500', async () => {
    vi.mocked(mediaSource.createMediaSource).mockImplementation(() => {
      throw new Error('Some random error');
    });
    const { app } = createTestApp('ffmpeg');
    const res = await request(app)
      .get('/api/serve')
      .query({ path: '/file.mp4' });
    expect(res.status).toBe(500);
    expect(res.text).toBe('Serve error');
  });
});
