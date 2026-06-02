import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaHandler } from '../../src/core/media/media-handler';
import { createTestMediaService } from '../utils/test-factory';

const { mockValidateFileAccess, mockHandleAccessCheck } = vi.hoisted(() => ({
  mockValidateFileAccess: vi.fn(),
  mockHandleAccessCheck: vi.fn(),
}));

// Mocks
vi.mock('../../src/core/auth/access-validator', () => ({
  validateFileAccess: mockValidateFileAccess,
  handleAccessCheck: mockHandleAccessCheck,
}));

vi.mock('../../src/core/media/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: () => ({
      generateHeatmap: vi.fn().mockRejectedValue(new Error('Heatmap Fail')),
      setCacheDir: vi.fn(),
      getProgress: vi.fn().mockReturnValue(null),
    }),
  },
}));

describe('Final Coverage Boost Part 2', () => {
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createTestMediaService().service;
  });

  describe('Media Handler Additional Coverage', () => {
    it('serveMetadata: handles missing ffmpegPath', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const req = { query: { file: '/local.mp4' } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        send: vi.fn(),
        headersSent: false,
      } as any;

      const handler = new MediaHandler({
        ffmpegPath: null,
        cacheDir: '/tmp',
        mediaService: service,
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
        headersSent: false,
      } as any;

      const handler = new MediaHandler({
        ffmpegPath: 'ffmpeg',
        cacheDir: '/tmp',
        mediaService: service,
      });
      await handler.serveHeatmap(req, res, '/local.mp4');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Heatmap generation failed');
    });

    it('serveHeatmapProgress: handles null progress (not found)', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const req = { query: { file: '/local.mp4' } } as any;
      const res = {
        json: vi.fn(),
        headersSent: false,
      } as any;

      const handler = new MediaHandler({
        ffmpegPath: 'ffmpeg',
        cacheDir: '/tmp',
        mediaService: service,
      });
      await handler.serveHeatmapProgress(req, res, '/local.mp4');

      expect(res.json).toHaveBeenCalledWith({ progress: null });
    });
  });
});
