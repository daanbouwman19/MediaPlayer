import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import * as security from '../../src/core/security';
import { createApp } from '../../src/server/server';
import { createTestMediaService } from '../utils/test-factory';

// Mock dependencies
vi.mock('../../src/core/database');
vi.mock('../../src/core/media-service');
vi.mock('../../src/core/file-system');
vi.mock('../../src/core/security');

// Mock Google Drive Service to prevent importing googleapis
vi.mock('../../src/main/google-drive-service', () => ({
  getDriveFileMetadata: vi.fn(),
  getDriveFileStream: vi.fn(),
}));

// Mock WorkerFactory to avoid electron import check
vi.mock('../../src/core/worker-factory', () => ({
  WorkerFactory: {
    getWorkerPath: vi
      .fn()
      .mockResolvedValue({ path: '/mock/worker.js', options: {} }),
  },
}));

// Mock ffmpeg-static to avoid binary resolution
vi.mock('ffmpeg-static', () => ({
  default: '/mock/ffmpeg',
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn().mockResolvedValue('mock-content'),
  },
}));

const { MockMediaHandler } = vi.hoisted(() => {
  class MockMediaHandler {
    serveMetadata = vi.fn((_req, res) => res.end());
    serveTranscodedStream = vi.fn((_req, res) => res.end());
    serveRawStream = vi.fn((_req, res) => res.end());
    serveThumbnail = vi.fn((_req, res) => res.end());
    serveStaticFile = vi.fn((_req, res) => res.end());
    serveHeatmap = vi.fn((_req, res) => res.end());
    serveHeatmapProgress = vi.fn((_req, res) => res.end());
    serveHlsMaster = vi.fn((_req, res) => res.end());
    serveHlsPlaylist = vi.fn((_req, res) => res.end());
    serveHlsSegment = vi.fn((_req, res) => res.end());
  }

  return { MockMediaHandler };
});

vi.mock('../../src/core/media-handler', () => ({
  MediaHandler: MockMediaHandler,
  serveMetadata: vi.fn((_req, res) => res.end()),
  serveTranscodedStream: vi.fn((_req, res) => res.end()),
  serveRawStream: vi.fn((_req, res) => res.end()),
  serveThumbnail: vi.fn((_req, res) => res.end()),
  serveStaticFile: vi.fn((_req, res) => res.end()),
}));

describe('Server CORS', () => {
  let app: any;

  // Save original env
  const originalEnv = process.env.NODE_ENV;
  const originalSessionSecret = process.env.SESSION_SECRET;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.SESSION_SECRET = originalSessionSecret;
    vi.clearAllMocks();
  });

  describe('Development Environment', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'test'; // isDev = true

      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: true,
        realPath: '/resolved/path',
      });
    });

    it('should block evil.com origin (by returning mismatched allowed origin)', async () => {
      const { service } = createTestMediaService();
      app = await createApp(service);
      const response = await request(app)
        .get('/api/config/extensions')
        .set('Origin', 'http://evil.com');

      // Should NOT be *
      expect(response.headers['access-control-allow-origin']).not.toBe('*');
      // In latest cors it may omit the header entirely if not matched.
      // Or if it strictly requires matched origin, it will return undefined for unmatched origin.
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('should allow localhost:5173', async () => {
      const { service } = createTestMediaService();
      app = await createApp(service);
      const response = await request(app)
        .get('/api/config/extensions')
        .set('Origin', 'http://localhost:5173');

      expect(response.headers['access-control-allow-origin']).toBe(
        'http://localhost:5173',
      );
    });
  });

  describe('Production Environment', () => {
    beforeEach(async () => {
      process.env.NODE_ENV = 'production'; // isDev = false
      process.env.SESSION_SECRET = 'test-secret';

      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: true,
        realPath: '/resolved/path',
      });
    });

    it('should disable CORS (Same-Origin enforced) by not sending headers', async () => {
      const { service } = createTestMediaService();
      app = await createApp(service);
      const response = await request(app)
        .get('/api/config/extensions')
        .set('Origin', 'http://evil.com');

      // In production, we pass origin: false to cors().
      // This means no Access-Control-Allow-Origin header should be present.
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
