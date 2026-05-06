import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  serveHlsMaster,
  serveHlsPlaylist,
  serveHlsSegment,
} from '../../src/core/hls-handler';
import {
  serveMetadata,
  serveHeatmap,
  serveHeatmapProgress,
  serveStaticFile,
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
    }),
  },
}));

vi.mock('../../src/core/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: () => ({
      generateHeatmap: vi.fn(),
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

describe('Coverage Fix - HandleAccessCheck Integration', () => {
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
      headersSent: false,
    };
  });

  // HLS Handler Coverage
  describe('HLS Handler Access Checks', () => {
    it('serveHlsMaster: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveHlsMaster(req, res, '/test.mp4');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
    });

    it('serveHlsPlaylist: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveHlsPlaylist(req, res, '/test.mp4');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
    });

    it('serveHlsSegment: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveHlsSegment(req, res, '/test.mp4', 'seg-000.ts');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.sendFile).not.toHaveBeenCalled();
    });
  });

  // Media Handler Coverage
  describe('Media Handler Access Checks', () => {
    it('serveMetadata: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveMetadata(req, res, '/test.mp4', 'ffmpeg');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('serveHeatmap: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveHeatmap(req, res, '/test.mp4');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('serveHeatmapProgress: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveHeatmapProgress(req, res, '/test.mp4');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('serveStaticFile: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      await serveStaticFile(req, res, '/test.mp4');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('handleStreamRequest: returns early if handleAccessCheck returns true', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockReturnValue(true);

      // We need to call the exported function, not method on class if mocking class
      // But here we are importing the functions directly
      await handleStreamRequest(req, res, 'ffmpeg');

      expect(mockHandleAccessCheck).toHaveBeenCalled();
      expect(res.sendFile).not.toHaveBeenCalled();
    });
  });
});
