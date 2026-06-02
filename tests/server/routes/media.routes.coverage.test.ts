import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import * as mediaRoutes from '../../../src/server/routes/media.routes';
import * as security from '../../../src/core/auth/security';
import * as mediaHandler from '../../../src/core/media/media-handler';
import { MAX_API_BATCH_SIZE } from '../../../src/core/media/constants';

// Mocks
vi.mock('../../../src/core/database/database');
vi.mock('../../../src/core/auth/security');

const mockQueueManager = vi.hoisted(() => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/core/media/transcode-queue-manager', () => ({
  TranscodeQueueManager: {
    getInstance: vi.fn(() => mockQueueManager),
  },
}));
vi.mock('../../../src/core/media/media-handler', () => ({
  MediaHandler: vi.fn(),
  serveRawStream: vi.fn(),
  serveTranscodedStream: vi.fn((_req, res) => {
    res.end('done');
    return Promise.resolve();
  }),
  validateFileAccess: vi.fn(),
}));
vi.mock('../../../src/core/media/media-source');

// Mock Limiters
const mockLimiters = {
  readLimiter: (_req: any, _res: any, next: any) => next(),
  writeLimiter: (_req: any, _res: any, next: any) => next(),
  fileLimiter: (_req: any, _res: any, next: any) => next(),
  streamLimiter: (_req: any, _res: any, next: any) => next(),
};

describe('Media Routes Coverage', () => {
  let app: express.Express;
  let mockMediaHandler: any;
  let transcodeState: { current: number };

  beforeEach(() => {
    vi.clearAllMocks();
    mockMediaHandler = {
      serveMetadata: vi.fn(),
      serveThumbnail: vi.fn(),
      serveHeatmap: vi.fn(),
      serveHeatmapProgress: vi.fn(),
      serveHlsMaster: vi.fn(),
      serveHlsPlaylist: vi.fn(),
      serveHlsSegment: vi.fn(),
    };
    transcodeState = { current: 0 };

    app = express();
    app.use(bodyParser.json());
    app.use(
      mediaRoutes.createMediaRoutes({
        limiters: mockLimiters as any,
        mediaHandler: mockMediaHandler,
        transcodeState,
        ffmpegPath: '/usr/bin/ffmpeg',
      }),
    );

    // Error handler
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    });

    // Default Security
    vi.mocked(security.authorizeFilePath).mockResolvedValue({
      isAllowed: true,
    } as any);
    vi.mocked(security.filterAuthorizedPaths).mockImplementation(
      async (paths) => paths,
    );
    vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
      success: true,
      path: '/file.mp4',
    });
  });

  describe('Validation & Errors', () => {
    it('POST /api/media/view missing filePath', async () => {
      const res = await request(app).post('/api/media/view').send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/media/view access denied', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: false,
        message: 'Denied',
      } as any);
      const res = await request(app)
        .post('/api/media/view')
        .send({ filePath: '/secret.mp4' });
      expect(res.status).toBe(403);
      expect(res.text).toBe('Denied');
    });

    it('POST /api/media/views invalid body', async () => {
      const res = await request(app)
        .post('/api/media/views')
        .send({ filePaths: 'not-array' });
      expect(res.status).toBe(400);
    });

    it('POST /api/media/views exceeds batch limit', async () => {
      const paths = Array(MAX_API_BATCH_SIZE + 1).fill('/path.mp4');
      const res = await request(app)
        .post('/api/media/views')
        .send({ filePaths: paths });
      expect(res.status).toBe(400);
      expect(res.text).toContain('Batch size exceeds limit');
    });

    it('POST /api/media/rate missing arguments', async () => {
      const res = await request(app)
        .post('/api/media/rate')
        .send({ filePath: '/f.mp4' }); // missing rating
      expect(res.status).toBe(400);
    });

    it('POST /api/media/playback-position missing arguments', async () => {
      const res = await request(app)
        .post('/api/media/playback-position')
        .send({ filePath: '/f.mp4' }); // missing position
      expect(res.status).toBe(400);
    });

    it('POST /api/media/playback-position rejects non-finite position', async () => {
      const res = await request(app)
        .post('/api/media/playback-position')
        .send({ filePath: '/f.mp4', position: 'oops' });
      expect(res.status).toBe(400);
    });

    it('POST /api/media/playback-position access denied', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValueOnce({
        isAllowed: false,
        message: 'nope',
      } as any);
      const res = await request(app)
        .post('/api/media/playback-position')
        .send({ filePath: '/f.mp4', position: 12 });
      expect(res.status).toBe(403);
    });

    it('POST /api/media/playback-position succeeds with valid input', async () => {
      const db = await import('../../../src/core/database/database');
      vi.mocked(db.updatePlaybackPosition).mockResolvedValue(undefined);
      const res = await request(app)
        .post('/api/media/playback-position')
        .send({ filePath: '/f.mp4', position: 30.5 });
      expect(res.status).toBe(200);
      expect(db.updatePlaybackPosition).toHaveBeenCalledWith('/f.mp4', 30.5);
    });

    it('POST /api/media/playback-position clamps negative positions to 0', async () => {
      const db = await import('../../../src/core/database/database');
      vi.mocked(db.updatePlaybackPosition).mockResolvedValue(undefined);
      const res = await request(app)
        .post('/api/media/playback-position')
        .send({ filePath: '/f.mp4', position: -5 });
      expect(res.status).toBe(200);
      expect(db.updatePlaybackPosition).toHaveBeenCalledWith('/f.mp4', 0);
    });

    it('POST /api/media/metadata missing arguments', async () => {
      const res = await request(app)
        .post('/api/media/metadata')
        .send({ filePath: '/f.mp4' }); // missing metadata
      expect(res.status).toBe(400);
    });

    it('POST /api/media/metadata/batch invalid body', async () => {
      const res = await request(app).post('/api/media/metadata/batch').send({});
      expect(res.status).toBe(400);
    });
  });

  describe('Streaming Logic', () => {
    it('GET /api/stream missing file', async () => {
      const res = await request(app).get('/api/stream');
      expect(res.status).toBe(400);
    });

    it('GET /api/stream access denied', async () => {
      vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
        success: false,
        statusCode: 403,
        error: 'Denied',
      });
      const res = await request(app).get('/api/stream?file=/denied.mp4');
      expect(res.status).toBe(403);
      expect(res.text).toBe('Denied');
    });

    it('GET /api/stream transcode limit reached', async () => {
      transcodeState.current = 1000; // Force limit
      const res = await request(app).get(
        '/api/stream?file=/v.mp4&transcode=true',
      );
      expect(res.status).toBe(503);
    });

    it('GET /api/stream transcode ffmpeg missing', async () => {
      // Recreate app with null ffmpegPath
      const appNoFfmpeg = express();
      appNoFfmpeg.use(
        mediaRoutes.createMediaRoutes({
          limiters: mockLimiters as any,
          mediaHandler: mockMediaHandler,
          transcodeState: { current: 0 },
          ffmpegPath: null,
        }),
      );

      const res = await request(appNoFfmpeg).get(
        '/api/stream?file=/v.mp4&transcode=true',
      );
      expect(res.status).toBe(500);
      expect(res.text).toBe('FFmpeg not found');
    });

    it('GET /api/stream transcode success updates state', async () => {
      await request(app).get('/api/stream?file=/v.mp4&transcode=true');
      expect(vi.mocked(mediaHandler.serveTranscodedStream)).toHaveBeenCalled();
    });
  });

  describe('Serve Route Errors', () => {
    it('GET /api/serve missing path', async () => {
      const res = await request(app).get('/api/serve');
      expect(res.status).toBe(400);
    });

    it('GET /api/serve access denied', async () => {
      vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
        success: false,
        statusCode: 403,
        error: 'Denied',
      });
      const res = await request(app).get('/api/serve?path=/denied');
      expect(res.status).toBe(403);
    });

    it('GET /api/serve generic error', async () => {
      vi.mocked(mediaHandler.validateFileAccess).mockRejectedValue(
        new Error('Random Error'),
      );
      const res = await request(app).get('/api/serve?path=/err');
      expect(res.status).toBe(500);
    });
  });

  describe('Transcode Job Routes', () => {
    it('POST /api/transcode/jobs enqueues paths', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: true,
      } as any);
      const res = await request(app)
        .post('/api/transcode/jobs')
        .send({ paths: ['/a.mp4', '/b.mp4'] });
      expect(res.status).toBe(204);
      expect(mockQueueManager.enqueue).toHaveBeenCalledTimes(2);
    });

    it('POST /api/transcode/jobs returns 400 for missing paths', async () => {
      const res = await request(app).post('/api/transcode/jobs').send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/transcode/jobs returns 400 for non-string path', async () => {
      const res = await request(app)
        .post('/api/transcode/jobs')
        .send({ paths: [123] });
      expect(res.status).toBe(400);
    });

    it('POST /api/transcode/jobs returns 403 if path not allowed', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: false,
        message: 'Forbidden',
      } as any);
      const res = await request(app)
        .post('/api/transcode/jobs')
        .send({ paths: ['/secret.mp4'] });
      expect(res.status).toBe(403);
    });

    it('GET /api/transcode/jobs returns job list', async () => {
      const { listTranscodeJobs } =
        await import('../../../src/core/database/database');
      vi.mocked(listTranscodeJobs).mockResolvedValue([
        { file_path: '/a.mp4', status: 'pending' } as any,
      ]);
      const res = await request(app).get('/api/transcode/jobs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ file_path: '/a.mp4', status: 'pending' }]);
    });

    it('DELETE /api/transcode/jobs cancels a job', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: true,
      } as any);
      const { deleteTranscodeJob } =
        await import('../../../src/core/database/database');
      const res = await request(app)
        .delete('/api/transcode/jobs')
        .send({ path: '/a.mp4' });
      expect(res.status).toBe(204);
      expect(deleteTranscodeJob).toHaveBeenCalledWith('/a.mp4');
    });

    it('DELETE /api/transcode/jobs returns 400 for missing path', async () => {
      const res = await request(app).delete('/api/transcode/jobs').send({});
      expect(res.status).toBe(400);
    });

    it('DELETE /api/transcode/jobs returns 403 if path not allowed', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: false,
        message: 'Denied',
      } as any);
      const res = await request(app)
        .delete('/api/transcode/jobs')
        .send({ path: '/secret.mp4' });
      expect(res.status).toBe(403);
    });
  });
});
