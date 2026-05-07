import { describe, it, expect, vi, beforeEach } from 'vitest';
import { serveHlsMaster, serveHlsPlaylist } from '../../src/core/hls-handler';
import {
  serveHeatmap,
  handleStreamRequest,
} from '../../src/core/media-handler';

// Mock dependencies
const { mockValidateFileAccess, mockHandleAccessCheck } = vi.hoisted(() => ({
  mockValidateFileAccess: vi.fn(),
  mockHandleAccessCheck: vi.fn(),
}));

vi.mock('../../src/core/access-validator', () => ({
  validateFileAccess: mockValidateFileAccess,
  handleAccessCheck: mockHandleAccessCheck,
}));

vi.mock('../../src/core/hls-manager', () => ({
  HlsManager: {
    getInstance: () => ({
      ensureSession: vi.fn(),
      getSessionDir: vi.fn().mockReturnValue('/tmp/session'),
      touchSession: vi.fn(),
      acquireSession: vi.fn(),
      releaseSession: vi.fn(),
    }),
  },
}));

const { mockGenerateHeatmap } = vi.hoisted(() => ({
  mockGenerateHeatmap: vi.fn(),
}));

vi.mock('../../src/core/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: () => ({
      generateHeatmap: mockGenerateHeatmap,
      getProgress: vi.fn(),
      setCacheDir: vi.fn(),
    }),
  },
}));

vi.mock('../../src/core/media-utils', () => ({
  isDrivePath: vi.fn().mockReturnValue(false),
  normalizeFilePath: vi.fn((p) => p),
  getThumbnailCachePath: vi.fn(),
  checkThumbnailCache: vi.fn(),
  getDriveId: vi.fn(),
  getQueryParam: vi.fn((q, k) => q[k]), // Simple mock
}));

vi.mock('../../src/core/utils/ffmpeg-utils', () => ({
  getFFmpegDuration: vi.fn(),
  getTranscodeArgs: vi.fn(),
}));

vi.mock('../../src/core/media-source', () => ({
  createMediaSource: vi.fn(() => ({
    getSize: vi.fn().mockResolvedValue(100),
    getMimeType: vi.fn().mockResolvedValue('video/mp4'),
    getStream: vi.fn(),
    getFFmpegInput: vi.fn(),
  })),
}));

vi.mock('../../src/core/thumbnail-handler', () => ({
  serveThumbnail: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    access: vi.fn(),
  },
}));

describe('Coverage Fix 2 - Branch Coverage Boost', () => {
  let req: any;
  let res: any;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { query: { file: '/test.mp4' }, headers: {} };
    res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      sendFile: vi.fn(),
      on: vi.fn(),
      headersSent: false,
    };
  });

  // HLS Handler Branch Coverage
  describe('HLS Handler Extra Branches', () => {
    it('serveHlsMaster: handles missing file query param', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/test.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);
      req.query = {}; // Missing 'file'

      await serveHlsMaster(req, res, '/test.mp4');

      // It should still serve, but with empty encoded file in playlist
      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('playlist.m3u8?file='),
      );
    });

    it('serveHlsPlaylist: handles missing file query param', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/test.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);
      req.query = {}; // Missing 'file'

      // Mock fs.readFile to return content needing replacement
      const fs = await import('fs/promises');
      vi.mocked(fs.default.readFile).mockResolvedValue('seg-001.ts');

      await serveHlsPlaylist(req, res, '/test.mp4');

      expect(res.send).toHaveBeenCalledWith(
        expect.stringContaining('seg-001.ts?file='),
      );
    });
  });

  // Media Handler Branch Coverage
  describe('Media Handler Extra Branches', () => {
    it('serveHeatmap: handles missing points query param (default 100)', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/test.mp4',
      });
      mockHandleAccessCheck.mockReturnValue(false);
      req.query = { file: '/test.mp4' }; // Missing 'points'

      await serveHeatmap(req, res, '/test.mp4');

      expect(mockGenerateHeatmap).toHaveBeenCalledWith('/test.mp4', 100);
    });

    it('handleStreamRequest: handles missing file param', async () => {
      req.query = {};
      await handleStreamRequest(req, res, 'ffmpeg');
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.send).toHaveBeenCalledWith('Missing file parameter');
    });
  });
});
