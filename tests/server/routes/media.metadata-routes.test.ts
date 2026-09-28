/**
 * Metadata write routes: POST /api/media/watched-segments (web parity with
 * the Electron IPC path, F137) and POST /api/media/metadata (F13).
 */
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import request from 'supertest';
import express from 'express';
import { createMediaRoutes } from '../../../src/server/routes/media.routes';
import { errorHandler } from '../../../src/server/middleware/error-handler';
import * as security from '../../../src/core/auth/security';
import * as database from '../../../src/core/database/database';
import { MAX_WATCHED_SEGMENTS } from '../../../src/core/database/metadata-validation';

vi.mock('../../../src/core/database/database');
vi.mock('../../../src/core/auth/security');
vi.mock('../../../src/core/media/transcode-queue-manager', () => ({
  TranscodeQueueManager: { getInstance: vi.fn() },
}));
vi.mock('../../../src/core/media/media-handler', () => ({
  MediaHandler: vi.fn(),
  serveRawStream: vi.fn(),
  serveTranscodedStream: vi.fn(),
  validateFileAccess: vi.fn(),
}));
vi.mock('../../../src/core/media/media-source');

const passThrough = (_req: unknown, _res: unknown, next: () => void) => next();
const limiters = {
  readLimiter: vi.fn(passThrough),
  writeLimiter: vi.fn(passThrough),
  telemetryLimiter: vi.fn(passThrough),
  fileLimiter: vi.fn(passThrough),
  streamLimiter: vi.fn(passThrough),
};

describe('media metadata routes', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(
      createMediaRoutes({
        limiters: limiters as any,
        mediaHandler: {} as any,
        transcodeState: { current: 0 },
        ffmpegPath: null,
      }),
    );
    app.use(errorHandler);
    vi.mocked(security.authorizeFilePath).mockResolvedValue({
      isAllowed: true,
    });
  });

  describe('POST /api/media/watched-segments', () => {
    const segmentsJson = JSON.stringify([{ start: 0, end: 12.5 }]);

    it('stores the segments of an authorized file', async () => {
      const res = await request(app)
        .post('/api/media/watched-segments')
        .send({ filePath: '/media/movie.mp4', segmentsJson });

      expect(res.status).toBe(200);
      expect(security.authorizeFilePath).toHaveBeenCalledWith(
        '/media/movie.mp4',
      );
      expect(database.updateWatchedSegments).toHaveBeenCalledWith(
        '/media/movie.mp4',
        segmentsJson,
      );
      // Saved every few seconds: must not consume the strict write budget.
      expect(limiters.readLimiter).toHaveBeenCalled();
      expect(limiters.writeLimiter).not.toHaveBeenCalled();
    });

    it('rejects files outside the library', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: false,
        message: 'Access denied',
      });
      const res = await request(app)
        .post('/api/media/watched-segments')
        .send({ filePath: 'gdrive://not-in-library', segmentsJson });

      expect(res.status).toBe(403);
      expect(database.updateWatchedSegments).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing filePath', { segmentsJson }],
      ['a non-string filePath', { filePath: 7, segmentsJson }],
      ['missing segments', { filePath: '/m.mp4' }],
      ['segments that are not JSON', { filePath: '/m.mp4', segmentsJson: '[' }],
      [
        'too many segments',
        {
          filePath: '/m.mp4',
          segmentsJson: JSON.stringify(
            Array.from({ length: MAX_WATCHED_SEGMENTS + 1 }, (_, i) => ({
              start: i,
              end: i + 1,
            })),
          ),
        },
      ],
    ])('returns 400 for %s', async (_label, body) => {
      const res = await request(app)
        .post('/api/media/watched-segments')
        .send(body);

      expect(res.status).toBe(400);
      expect(database.updateWatchedSegments).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/media/metadata', () => {
    it('cannot redirect the write to another path (F13)', async () => {
      const res = await request(app)
        .post('/api/media/metadata')
        .send({
          filePath: '/media/ok.mp4',
          metadata: { filePath: 'gdrive://any-id', duration: 3 },
        });

      expect(res.status).toBe(200);
      expect(security.authorizeFilePath).toHaveBeenCalledWith('/media/ok.mp4');
      expect(database.upsertMetadata).toHaveBeenCalledWith('/media/ok.mp4', {
        duration: 3,
      });
    });

    it('returns 400 for a field with the wrong type', async () => {
      const res = await request(app)
        .post('/api/media/metadata')
        .send({ filePath: '/media/ok.mp4', metadata: { rating: 'max' } });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid metadata field: rating' });
      expect(database.upsertMetadata).not.toHaveBeenCalled();
    });
  });
});
