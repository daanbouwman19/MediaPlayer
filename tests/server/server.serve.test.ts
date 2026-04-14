import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/server';
import { serveRawStream } from '../../src/core/media-handler';
import { createMediaSource } from '../../src/core/media-source';

const { mockValidateFileAccess } = vi.hoisted(() => ({
  mockValidateFileAccess: vi.fn(),
}));

// Mock dependencies
vi.mock('../../src/core/database', () => ({
  initDatabase: vi.fn(),
  getMediaDirectories: vi.fn().mockResolvedValue([]),
  getAlbumsWithViewCounts: vi.fn(),
  getAlbumsWithViewCountsAfterScan: vi.fn(),
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  getRecentlyPlayed: vi.fn(),
  addMediaDirectory: vi.fn(),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
}));

vi.mock('../../src/core/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn().mockReturnValue({
      generateHeatmap: vi.fn().mockResolvedValue({ points: 100 }),
      setCacheDir: vi.fn(),
    }),
  },
}));

vi.mock('../../src/core/media-handler', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media-handler')>();
  return {
    ...actual,
    serveRawStream: vi.fn((_req, res) => res.end()), // Fix: Ensure response is ended
    // serveHeatmap: Use actual implementation to test its validation logic
  };
});
vi.mock('../../src/core/media-source', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media-source')>();
  return {
    ...actual,
    createMediaSource: vi.fn(),
  };
});
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    realpath: vi.fn(),
  },
}));

// Mock drive-cache-manager to avoid init issues
vi.mock('../../src/main/drive-cache-manager', () => ({
  initializeDriveCacheManager: vi.fn(),
}));

vi.mock('../../src/main/google-auth', () => ({
  generateAuthUrl: vi.fn(),
  authenticateWithCode: vi.fn(),
}));

vi.mock('../../src/main/google-drive-service', () => ({
  getDriveClient: vi.fn(),
  listDriveDirectory: vi.fn(),
  getDriveParent: vi.fn(),
}));

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

// Mock process.cwd to something stable
vi.spyOn(process, 'cwd').mockReturnValue('/app');

describe('Server Endpoint Security', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createTestMediaService } = await import('../utils/test-factory');
    const { service } = createTestMediaService();
    app = await createApp(service);
  });

  describe('GET /api/serve', () => {
    it('should explicitly validate file access before serving', async () => {
      const filePath = '/unauthorized/file.mp4';

      // Mock validation to fail
      mockValidateFileAccess.mockResolvedValue({
        success: false,
        error: 'Access denied',
        statusCode: 403,
      });

      const response = await request(app)
        .get('/api/serve')
        .query({ path: filePath });

      expect(response.status).toBe(403);
      // Should verify that validateFileAccess was called
      expect(mockValidateFileAccess).toHaveBeenCalledWith(filePath);

      // Should verify that createMediaSource was NOT called (short-circuit)
      expect(createMediaSource).not.toHaveBeenCalled();
      expect(serveRawStream).not.toHaveBeenCalled();
    });

    it('should proceed if validation passes', async () => {
      const filePath = '/authorized/file.mp4';

      // Mock validation to pass
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: filePath,
      });

      await request(app).get('/api/serve').query({ path: filePath });

      expect(mockValidateFileAccess).toHaveBeenCalledWith(filePath);
      expect(createMediaSource).toHaveBeenCalledWith(filePath);
      expect(serveRawStream).toHaveBeenCalled();
    });
  });

  describe('GET /api/video/heatmap', () => {
    it('should validate file access', async () => {
      const filePath = '/unauthorized/video.mp4';
      mockValidateFileAccess.mockResolvedValue({
        success: false,
        error: 'Access denied',
        statusCode: 403,
      });

      // Since we mock validateFileAccess directly, and MediaHandler uses handleAccessCheck,
      // we need to ensure handleAccessCheck behaves correctly given the mockValidateFileAccess return.
      // However, handleAccessCheck is implemented in the real code, not mocked here unless we mock access-validator entirely.
      // In this test file we did: vi.mock('../../src/core/access-validator', ...
      // Let's check the mock implementation at the top of the file.

      const response = await request(app)
        .get('/api/video/heatmap')
        .query({ file: filePath });

      expect(response.status).toBe(403);
      expect(mockValidateFileAccess).toHaveBeenCalledWith(filePath);
    });

    it('should serve heatmap if authorized', async () => {
      const filePath = '/authorized/video.mp4';
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: filePath,
      });

      const response = await request(app)
        .get('/api/video/heatmap')
        .query({ file: filePath });

      expect(response.status).toBe(200);
      // expect(serveHeatmap).toHaveBeenCalled();
    });

    it('should return 400 if file param missing', async () => {
      const response = await request(app).get('/api/video/heatmap');
      expect(response.status).toBe(400);
    });
  });
});
