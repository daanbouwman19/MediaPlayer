import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'stream';
import fs from 'fs'; // Import for spying
import {
  serveThumbnail,
  generateLocalThumbnail,
} from '../../src/core/media/thumbnail-handler';

const {
  mockRunFFmpeg,
  mockGetDriveFileThumbnail,
  mockAuthorizeFilePath,
  mockGetThumbnailCachePath,
  mockValidateFileAccess,
  mockHandleAccessCheck,
} = vi.hoisted(() => ({
  mockRunFFmpeg: vi.fn(),
  mockGetDriveFileThumbnail: vi.fn(),
  mockAuthorizeFilePath: vi.fn(),
  mockGetThumbnailCachePath: vi.fn(),
  mockValidateFileAccess: vi.fn(),
  mockHandleAccessCheck: vi.fn(),
}));

// Mock dependencies
vi.mock('../../src/main/google-drive-service', () => ({
  getDriveFileThumbnail: mockGetDriveFileThumbnail,
}));

vi.mock('../../src/core/auth/security', () => ({
  authorizeFilePath: mockAuthorizeFilePath,
}));

vi.mock('../../src/core/auth/access-validator', () => ({
  validateFileAccess: mockValidateFileAccess,
  handleAccessCheck: mockHandleAccessCheck,
}));

vi.mock('../../src/core/media/media-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media/media-utils')>();
  return {
    ...actual,
    getThumbnailCachePath: mockGetThumbnailCachePath,
  };
});

vi.mock('../../src/infrastructure/ffmpeg-utils', () => ({
  getThumbnailArgs: vi.fn(),
  runFFmpeg: mockRunFFmpeg,
}));

vi.mock(
  '../../src/infrastructure/fs-provider-factory',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('../../src/infrastructure/fs-provider-factory')
      >();
    return {
      ...actual,
      getProvider: vi.fn().mockImplementation(actual.getProvider),
    };
  },
);

describe('thumbnail-handler unit tests', () => {
  let req: any;
  let res: any;

  let mockFsCreateWriteStream: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset persistent mocks
    mockRunFFmpeg.mockReset();
    mockGetDriveFileThumbnail.mockReset();
    mockAuthorizeFilePath.mockReset();
    mockGetThumbnailCachePath.mockReset();

    // Setup spies
    mockFsCreateWriteStream = vi.spyOn(fs, 'createWriteStream');
    mockFsCreateWriteStream.mockReturnValue(new EventEmitter());

    // Default mock implementation for authorizeFilePath
    mockAuthorizeFilePath.mockResolvedValue({
      isAllowed: true,
      realPath: '/test/path',
    });

    // Default mock for ensureAuthorizedAccess
    mockValidateFileAccess.mockResolvedValue({
      success: true,
      path: '/test/path',
    });
    mockHandleAccessCheck.mockReturnValue(false);

    req = {};
    res = {
      writeHead: vi.fn(),
      end: vi.fn(),
      headersSent: false,
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      set: vi.fn().mockReturnThis(),
      sendFile: vi.fn((_path, _options, cb) => {
        // Default success
        if (cb) cb(null);
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('serveThumbnail', () => {
    it('serves from cache if available', async () => {
      // Must allow file access first
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      const cachePath = '/cache/thumb.jpg';
      mockGetThumbnailCachePath.mockReturnValue(cachePath);

      // Setup res.sendFile to succeed
      res.sendFile.mockImplementation(
        (_path: string, _options: any, cb: any) => {
          cb(null); // Success
        },
      );

      await serveThumbnail(req, res, '/video.mp4', 'ffmpeg', '/cache');

      expect(res.sendFile).toHaveBeenCalledWith(
        cachePath,
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'image/jpeg' }),
        }),
        expect.any(Function),
      );
    });

    it('should BLOCK thumbnail if file is unauthorized EVEN IF cached', async () => {
      // 1. Setup unauthorized file access
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockImplementation((res) => {
        res.status(403).send('Access denied.');
        return true;
      });

      // 2. Setup CACHE HIT? No, access check prevents checking cache

      await serveThumbnail(req, res, '/secret/video.mp4', 'ffmpeg', '/cache');

      // Expect 403 Forbidden because access check should happen before cache check
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Access denied.');
      // Should NOT have attempted to read cache stream or sendFile
      expect(res.sendFile).not.toHaveBeenCalled();
    });

    it('generates thumbnail for gdrive file', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: 'gdrive://123',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      // Mock cache miss (sendFile fails)
      res.sendFile.mockImplementation(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      mockGetThumbnailCachePath.mockReturnValue('/cache/gdrive.jpg');

      const mockDriveStream = { pipe: vi.fn() };
      mockGetDriveFileThumbnail.mockResolvedValue(mockDriveStream);

      const mockWriteStream = {};
      mockFsCreateWriteStream.mockReturnValue(mockWriteStream as any);

      await serveThumbnail(req, res, 'gdrive://123', 'ffmpeg', '/cache');

      expect(mockGetDriveFileThumbnail).toHaveBeenCalledWith('123');
      expect(mockDriveStream.pipe).toHaveBeenCalledWith(expect.anything());
      expect(mockDriveStream.pipe).toHaveBeenCalledWith(res);
    });

    it('returns 404 if drive fetch fails', async () => {
      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: 'gdrive://123',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      // Mock cache miss
      res.sendFile.mockImplementation(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      mockGetThumbnailCachePath.mockReturnValue('/cache/gdrive.jpg');
      mockGetDriveFileThumbnail.mockRejectedValue(new Error('Drive error'));

      await serveThumbnail(req, res, 'gdrive://123', 'ffmpeg', '/cache');

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.end).toHaveBeenCalled();
    });

    it('returns 500 if local file access denied', async () => {
      // Mock cache miss? Or logic is: Validate Access -> Check Cache -> ...
      // If access denied, it happens before cache check.

      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockImplementation((res) => {
        res.status(403).send('Access denied.');
        return true;
      });

      await serveThumbnail(req, res, '/local/vid.mp4', 'ffmpeg', '/cache');

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Access denied.');
    });

    it('returns 500 if auth threw error', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockImplementation((res) => {
        res.status(500).send('Internal server error.');
        return true;
      });

      await serveThumbnail(req, res, '/local/vid.mp4', 'ffmpeg', '/cache');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Internal server error.');
    });

    it('handles ffmpg generation for local file', async () => {
      // Mock cache miss
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );
      // Mock success for generation sendFile
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(null);
        },
      );

      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file',
      });
      mockHandleAccessCheck.mockReturnValue(false);
      mockGetThumbnailCachePath.mockReturnValue('/cache/local.jpg');

      // Mock runFFmpeg success
      mockRunFFmpeg.mockResolvedValue({ code: 0, stderr: '' });

      await serveThumbnail(req, res, '/video.mp4', 'ffmpeg', '/cache');

      expect(mockRunFFmpeg).toHaveBeenCalled();
      // Should call sendFile twice: once for cache check (failed), once for result (success)
      expect(res.sendFile).toHaveBeenCalledTimes(2);
      expect(res.sendFile).toHaveBeenLastCalledWith(
        '/cache/local.jpg',
        expect.anything(),
        expect.any(Function),
      );
    });

    it('handles ffmpeg failure (non-zero exit)', async () => {
      // Cache miss
      res.sendFile.mockImplementation(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      // Mock runFFmpeg failure
      mockRunFFmpeg.mockResolvedValue({ code: 1, stderr: 'Error' });

      await serveThumbnail(req, res, '/video.mp4', 'ffmpeg', '/cache');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Generation failed');
    });

    // "handles ffmpeg close success but file missing"
    // Now this is implicitly handled by res.sendFile after generation returning error
    it('handles ffmpeg success but file missing (generation failed silently)', async () => {
      // Cache miss
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );
      // Generation "success"
      mockRunFFmpeg.mockResolvedValue({ code: 0, stderr: '' });

      // But sending generated file fails
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await serveThumbnail(req, res, '/video.mp4', 'ffmpeg', '/cache');

      // It logs error and ends response 500
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Thumbnail] Error sending generated file:',
        expect.anything(),
      );
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.end).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('handles runFFmpeg error (e.g. timeout)', async () => {
      // Cache miss
      res.sendFile.mockImplementation(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      mockRunFFmpeg.mockRejectedValue(new Error('Process timed out'));

      await serveThumbnail(req, res, '/video.mp4', 'ffmpeg', '/cache');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('Generation failed');
    });

    it('returns 500 if ffmpeg binary is not found', async () => {
      // Cache miss
      res.sendFile.mockImplementation(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file',
      });
      mockHandleAccessCheck.mockReturnValue(false);

      await serveThumbnail(req, res, '/video.mp4', null, '/cache');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith('FFmpeg binary not found');
    });

    it('handles cache read error (cache miss)', async () => {
      const cachePath = '/cache/thumb.jpg';
      mockGetThumbnailCachePath.mockReturnValue(cachePath);

      // Simulate cache error (not found or read error)
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('Cache read failed'));
        },
      );

      // Setup generation mocks for fallback
      mockRunFFmpeg.mockResolvedValue({ code: 0, stderr: '' });

      // Generation sendFile success
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(null);
        },
      );

      const promise = serveThumbnail(
        req,
        res,
        '/video.mp4',
        'ffmpeg',
        '/cache',
      );

      await promise;

      // Should fall back to generation
      expect(mockRunFFmpeg).toHaveBeenCalled();
    });

    it('handles stream error during sending generated file', async () => {
      // Cache miss
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('ENOENT'));
        },
      );

      mockValidateFileAccess.mockResolvedValue({
        success: true,
        path: '/local/file',
      });
      mockHandleAccessCheck.mockReturnValue(false);
      mockGetThumbnailCachePath.mockReturnValue('/cache/local.jpg');

      mockRunFFmpeg.mockResolvedValue({ code: 0, stderr: '' });

      // Generation sendFile error
      res.sendFile.mockImplementationOnce(
        (_path: string, _options: any, cb: any) => {
          cb(new Error('Stream error'));
        },
      );

      await serveThumbnail(req, res, '/video.mp4', 'ffmpeg', '/cache');

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.end).toHaveBeenCalled();
    });
  });

  describe('generateLocalThumbnail', () => {
    it('returns error if file access fails', async () => {
      mockValidateFileAccess.mockResolvedValue({ success: false });
      mockHandleAccessCheck.mockImplementation((res) => {
        res.status(403).send('Access denied.');
        return true;
      });
      await generateLocalThumbnail(res, '/denied.mp4', '/cache.jpg', 'ffmpeg');
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Access denied.');
    });
  });
});
