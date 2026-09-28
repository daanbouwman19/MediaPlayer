import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import request from 'supertest';
import express from 'express';
import { createAlbumRoutes } from '../../../src/server/routes/album.routes';
import { errorHandler } from '../../../src/server/middleware/error-handler';
import { filterAuthorizedLibraryPaths } from '../../../src/core/media/utils/authorized-paths';
import { getFFmpegStaticPath } from '../../../src/infrastructure/ffmpeg-static-path';
import { MAX_API_BATCH_SIZE } from '../../../src/core/media/constants';
import { createTestMediaService } from '../../utils/test-factory';
import type { MediaService } from '../../../src/core/media/media-service';
import type { TestDependencies } from '../../utils/test-factory';

vi.mock('../../../src/core/media/utils/authorized-paths', () => ({
  filterAuthorizedLibraryPaths: vi.fn(),
}));

vi.mock('../../../src/infrastructure/ffmpeg-static-path', () => ({
  getFFmpegStaticPath: vi.fn(() => '/bundled/ffmpeg'),
}));

/** A promise that the test resolves by hand. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const pass = (_req: unknown, _res: unknown, next: () => void) => next();
const limiters = {
  readLimiter: pass,
  writeLimiter: pass,
  fileLimiter: pass,
  streamLimiter: pass,
} as any;

function buildApp(service: MediaService, ffmpegPath?: string | null) {
  const app = express();
  app.use(express.json());
  app.use(
    ffmpegPath === undefined
      ? createAlbumRoutes(limiters, service)
      : createAlbumRoutes(limiters, service, ffmpegPath),
  );
  app.use(errorHandler);
  return app;
}

describe('album routes', () => {
  let service: MediaService;
  let deps: TestDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ service, deps } = createTestMediaService());
    deps.mediaRepo.setMediaDirectories([
      { id: '1', path: '/media', type: 'local', name: 'm', isActive: true },
    ]);
    deps.workerService.setScanResult([
      {
        id: '/media',
        name: 'media',
        textures: [{ name: 'clip.mp4', path: '/media/clip.mp4' }],
        children: [],
      },
    ]);
    deps.mediaHandler.setDuration('/media/clip.mp4', 42);
  });

  describe('F11: web scans extract and store metadata', () => {
    it('GET /api/albums passes the bundled ffmpeg by default', async () => {
      const spy = vi.spyOn(service, 'getAlbumsWithViewCounts');

      const res = await request(buildApp(service)).get('/api/albums');

      expect(res.status).toBe(200);
      expect(getFFmpegStaticPath).toHaveBeenCalled();
      expect(spy).toHaveBeenCalledWith('/bundled/ffmpeg');
    });

    it('POST /api/albums/reindex stores durations in the background', async () => {
      const res = await request(buildApp(service, '/ffmpeg')).post(
        '/api/albums/reindex',
      );

      expect(res.status).toBe(200);
      expect(res.body[0].textures[0].path).toBe('/media/clip.mp4');
      await vi.waitFor(async () => {
        const meta = await deps.mediaRepo.getMetadata(['/media/clip.mp4']);
        expect(meta['/media/clip.mp4']).toMatchObject({
          status: 'success',
          duration: 42,
        });
      });
    });

    it('skips extraction when ffmpeg is unavailable', async () => {
      const spy = vi.spyOn(service, 'getAlbumsWithViewCountsAfterScan');
      const res = await request(buildApp(service, null)).post(
        '/api/albums/reindex',
      );
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledWith(undefined);
    });

    it('reports scan failures as 500', async () => {
      vi.spyOn(service, 'getAlbumsWithViewCounts').mockRejectedValue(
        new Error('db down'),
      );
      vi.spyOn(service, 'getAlbumsWithViewCountsAfterScan').mockRejectedValue(
        new Error('db down'),
      );
      const app = buildApp(service, '/ffmpeg');

      const get = await request(app).get('/api/albums');
      expect(get.status).toBe(500);
      expect(get.body.error).toBe('Failed to fetch albums');

      const post = await request(app).post('/api/albums/reindex');
      expect(post.status).toBe(500);
      expect(post.body.error).toBe('Failed to reindex');
    });
  });

  describe('POST /api/media/extract-metadata', () => {
    it('extracts metadata for the authorized paths only', async () => {
      vi.mocked(filterAuthorizedLibraryPaths).mockResolvedValue([
        '/media/clip.mp4',
      ]);
      const spy = vi.spyOn(service, 'extractAndSaveMetadata');

      const res = await request(buildApp(service, '/ffmpeg'))
        .post('/api/media/extract-metadata')
        .send({ filePaths: ['/media/clip.mp4', '/etc/passwd'] });

      expect(res.status).toBe(202);
      expect(filterAuthorizedLibraryPaths).toHaveBeenCalledWith([
        '/media/clip.mp4',
        '/etc/passwd',
      ]);
      await vi.waitFor(() =>
        expect(spy).toHaveBeenCalledWith(['/media/clip.mp4'], '/ffmpeg', {
          forceCheck: true,
        }),
      );
      await vi.waitFor(async () => {
        const meta = await deps.mediaRepo.getMetadata(['/media/clip.mp4']);
        expect(meta['/media/clip.mp4']?.duration).toBe(42);
      });
    });

    it('F94: overlapping requests run one extraction job at a time', async () => {
      vi.mocked(filterAuthorizedLibraryPaths).mockImplementation(
        async (paths) => paths,
      );
      const gates = [deferred(), deferred()];
      let active = 0;
      let maxActive = 0;
      const extract = vi
        .spyOn(service, 'extractAndSaveMetadata')
        .mockImplementation(async () => {
          const gate = gates[extract.mock.calls.length - 1];
          active++;
          maxActive = Math.max(maxActive, active);
          await gate?.promise;
          active--;
        });
      const app = buildApp(service, '/ffmpeg');

      const first = await request(app)
        .post('/api/media/extract-metadata')
        .send({ filePaths: ['/media/a.mp4', '/media/b.mp4'] });
      const second = await request(app)
        .post('/api/media/extract-metadata')
        .send({ filePaths: ['/media/c.mp4'] });

      expect(first.status).toBe(202);
      expect(second.status).toBe(202);
      await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 10));
      // The second request waits for the running job instead of starting one.
      expect(extract).toHaveBeenCalledTimes(1);
      expect(extract).toHaveBeenLastCalledWith(
        ['/media/a.mp4', '/media/b.mp4'],
        '/ffmpeg',
        { forceCheck: true },
      );

      gates[0]!.resolve();
      await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
      expect(extract).toHaveBeenLastCalledWith(['/media/c.mp4'], '/ffmpeg', {
        forceCheck: true,
      });
      gates[1]!.resolve();
      await vi.waitFor(() => expect(active).toBe(0));
      expect(maxActive).toBe(1);
    });

    it.each([
      [{}],
      [{ filePaths: 'not-an-array' }],
      [{ filePaths: ['/ok', 42] }],
    ])('rejects invalid bodies (%j)', async (body) => {
      const res = await request(buildApp(service, '/ffmpeg'))
        .post('/api/media/extract-metadata')
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid filePaths');
    });

    it('rejects oversized batches', async () => {
      const filePaths = Array.from(
        { length: MAX_API_BATCH_SIZE + 1 },
        (_, i) => `/media/${i}.jpg`,
      );
      const res = await request(buildApp(service, '/ffmpeg'))
        .post('/api/media/extract-metadata')
        .send({ filePaths });
      expect(res.status).toBe(400);
      expect(filterAuthorizedLibraryPaths).not.toHaveBeenCalled();
    });

    it('does nothing when ffmpeg is unavailable', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const spy = vi.spyOn(service, 'extractAndSaveMetadata');

      const res = await request(buildApp(service, null))
        .post('/api/media/extract-metadata')
        .send({ filePaths: ['/media/clip.mp4'] });

      expect(res.status).toBe(202);
      expect(warn).toHaveBeenCalledWith(
        'FFmpeg not found, skipping metadata extraction',
      );
      expect(spy).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('logs background extraction failures', async () => {
      vi.mocked(filterAuthorizedLibraryPaths).mockResolvedValue(['/a.mp4']);
      vi.spyOn(service, 'extractAndSaveMetadata').mockRejectedValue(
        new Error('boom'),
      );
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await request(buildApp(service, '/ffmpeg'))
        .post('/api/media/extract-metadata')
        .send({ filePaths: ['/a.mp4'] });

      expect(res.status).toBe(202);
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          '[media-service] Background metadata extraction failed:',
          expect.any(Error),
        ),
      );
      error.mockRestore();
    });
  });
});
