import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import { getServerPort } from '../../../src/main/local-server';
import {
  generateFileUrl,
  getVideoDuration,
} from '../../../src/core/media-handler';
import {
  validatePathAccess,
  filterAuthorizedPaths,
} from '../../../src/main/utils/security-utils';
import {
  recordMediaView,
  getMediaViewCounts,
  getRecentlyPlayed,
} from '../../../src/main/database';
import {
  getDriveFileMetadata,
  listDriveDirectory,
  getDriveParent,
} from '../../../src/main/google-drive-service';
import {
  getAlbumsWithViewCounts,
  getAlbumsWithViewCountsAfterScan,
  extractAndSaveMetadata,
} from '../../../src/core/media-service';
import { generateSessionId } from '../../../src/core/hls-handler';

// --- Global Mocks ---

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/main/local-server', () => ({
  getServerPort: vi.fn(),
}));

vi.mock('../../../src/core/media-handler', () => ({
  generateFileUrl: vi.fn(),
  getVideoDuration: vi.fn(),
}));

vi.mock('../../../src/main/utils/security-utils', () => ({
  validatePathAccess: vi.fn(),
  filterAuthorizedPaths: vi.fn(),
}));

vi.mock('../../../src/main/database', () => ({
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  getRecentlyPlayed: vi.fn(),
}));

vi.mock('../../../src/main/google-drive-service', () => ({
  getDriveFileMetadata: vi.fn(),
  listDriveDirectory: vi.fn(),
  getDriveParent: vi.fn(),
}));

vi.mock('../../../src/core/media-service', () => ({
  getAlbumsWithViewCounts: vi.fn(),
  getAlbumsWithViewCountsAfterScan: vi.fn(),
  extractAndSaveMetadata: vi.fn(),
}));

vi.mock('../../../src/core/hls-handler', () => ({
  generateSessionId: vi.fn(),
}));

// Default mock for ffmpeg-static (can be overridden in specific tests via vi.doMock if needed, but here we use a variable)
// Since we are in the same file, we can't easily re-mock top-level imports per test unless we use `vi.doMock` and dynamic imports.
// Instead, we can mock it to return a value we can change, OR separate the "ffmpeg missing" tests if they require a null value.
// `media-controller.ts` imports `ffmpegPath` at the top level?
// No, it imports `ffmpegPath` from `ffmpeg-static` and uses it.
// If it imports it at top level, changing it is hard.
// Let's check `media-controller.ts`. It likely does `import ffmpegPath from 'ffmpeg-static'`.
// If so, the value is fixed at import time.
// To support "missing ffmpeg" tests, we might need to rely on `vi.mock` factory hoisting.
// But we want to combine tests.
// Strategy: Use `vi.mock` with a factory that returns a getter, or mocking a module that exports it.
// `ffmpeg-static` exports a string (path) or null.
// Let's mock it to return a mock object/function or just a string that we verify.
// BUT `media-controller.ts` probably checks `if (ffmpegPath)`.
// If we set it to `/mock/ffmpeg`, we can't test the "missing" case easily without reloading the module.
// However, looking at `media-controller.ffmpeg.test.ts`, it mocks it to `null`.
// So we have a conflict: Normal tests need string, error tests need null.
// Solution: Use `vi.doMock` for the "missing" suite and dynamic import of the controller.

describe('Media Controller Combined', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (handleIpc as Mock).mockClear();
  });

  const getHandler = (channel: string) => {
    const call = (handleIpc as Mock).mock.calls.find((c) => c[0] === channel);
    if (!call) throw new Error(`Handler for ${channel} not found`);
    return call[1];
  };

  describe('Standard Operation (FFmpeg Present)', () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.doMock('ffmpeg-static', () => ({ default: '/mock/ffmpeg' }));
      const { registerMediaHandlers } =
        await import('../../../src/main/ipc/media-controller');
      registerMediaHandlers();
    });

    // --- From media-controller.test.ts ---
    describe('LOAD_FILE_AS_DATA_URL', () => {
      it('generates file url', async () => {
        const handler = getHandler(IPC_CHANNELS.LOAD_FILE_AS_DATA_URL);
        (getServerPort as Mock).mockReturnValue(3000);
        (generateFileUrl as Mock).mockReturnValue('http://url');

        const result = await handler({}, '/path/to/file', { preferHttp: true });

        expect(generateFileUrl).toHaveBeenCalledWith('/path/to/file', {
          serverPort: 3000,
          preferHttp: true,
        });
        expect(result).toBe('http://url');
      });
    });

    describe('RECORD_MEDIA_VIEW', () => {
      it('records view', async () => {
        const handler = getHandler(IPC_CHANNELS.RECORD_MEDIA_VIEW);
        await handler({}, '/path/to/file');
        expect(recordMediaView).toHaveBeenCalledWith('/path/to/file');
      });

      it('validates path in separate validator', () => {
        const call = (handleIpc as Mock).mock.calls.find(
          (c) => c[0] === IPC_CHANNELS.RECORD_MEDIA_VIEW,
        )!;
        const options = call[2];
        expect(options.validators).toHaveLength(1);

        options.validators[0]('/path/to/file');
        expect(validatePathAccess).toHaveBeenCalledWith('/path/to/file');
      });
    });

    describe('GET_MEDIA_VIEW_COUNTS', () => {
      it('filters paths and gets counts', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_MEDIA_VIEW_COUNTS);
        (filterAuthorizedPaths as Mock).mockResolvedValue(['/path/1']);
        (getMediaViewCounts as Mock).mockResolvedValue({ '/path/1': 10 });

        const result = await handler({}, ['/path/1', '/path/2']);

        expect(filterAuthorizedPaths).toHaveBeenCalledWith([
          '/path/1',
          '/path/2',
        ]);
        expect(getMediaViewCounts).toHaveBeenCalledWith(['/path/1']);
        expect(result).toEqual({ '/path/1': 10 });
      });
    });

    describe('GET_VIDEO_METADATA', () => {
      it('handles gdrive files', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_VIDEO_METADATA);
        (getDriveFileMetadata as Mock).mockResolvedValue({
          videoMediaMetadata: { durationMillis: '2000' },
        });

        const result = await handler({}, 'gdrive://123');

        expect(getDriveFileMetadata).toHaveBeenCalledWith('123');
        expect(result).toEqual({ duration: 2 });
      });

      it('throws if gdrive duration missing', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_VIDEO_METADATA);
        (getDriveFileMetadata as Mock).mockResolvedValue({});

        await expect(handler({}, 'gdrive://123')).rejects.toThrow(
          'Duration not available',
        );
      });

      it('handles local files', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_VIDEO_METADATA);
        (validatePathAccess as Mock).mockResolvedValue(undefined);
        (getVideoDuration as Mock).mockResolvedValue({ duration: 5 });

        const result = await handler({}, '/path/to.mp4');

        expect(validatePathAccess).toHaveBeenCalledWith('/path/to.mp4');
        expect(getVideoDuration).toHaveBeenCalledWith(
          '/path/to.mp4',
          '/mock/ffmpeg',
        );
        expect(result).toEqual({ duration: 5 });
      });

      it('throws if getVideoDuration returns error', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_VIDEO_METADATA);
        (validatePathAccess as Mock).mockResolvedValue(undefined);
        (getVideoDuration as Mock).mockResolvedValue({ error: 'Fail' });

        await expect(handler({}, '/path/to.mp4')).rejects.toThrow('Fail');
      });
    });

    describe('GET_ALBUMS_WITH_VIEW_COUNTS', () => {
      it('calls service', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_ALBUMS_WITH_VIEW_COUNTS);
        await handler({});
        expect(getAlbumsWithViewCounts).toHaveBeenCalledWith('/mock/ffmpeg');
      });
    });

    describe('REINDEX_MEDIA_LIBRARY', () => {
      it('calls service', async () => {
        const handler = getHandler(IPC_CHANNELS.REINDEX_MEDIA_LIBRARY);
        await handler({});
        expect(getAlbumsWithViewCountsAfterScan).toHaveBeenCalledWith(
          '/mock/ffmpeg',
        );
      });
    });

    describe('MEDIA_EXTRACT_METADATA', () => {
      it('extracts metadata', async () => {
        const handler = getHandler(IPC_CHANNELS.MEDIA_EXTRACT_METADATA);
        (filterAuthorizedPaths as Mock).mockResolvedValue(['/path']);
        (extractAndSaveMetadata as Mock).mockResolvedValue(undefined);
        await handler({}, ['/path']);
        expect(extractAndSaveMetadata).toHaveBeenCalledWith(
          ['/path'],
          '/mock/ffmpeg',
          { forceCheck: true },
        );
      });

      it('logs error on extraction failure', async () => {
        const handler = getHandler(IPC_CHANNELS.MEDIA_EXTRACT_METADATA);
        (filterAuthorizedPaths as Mock).mockResolvedValue(['/path']);
        (extractAndSaveMetadata as Mock).mockRejectedValue(
          new Error('Extract Fail'),
        );
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});

        await handler({}, ['/path']);
        await new Promise((r) => setTimeout(r, 10));

        expect(extractAndSaveMetadata).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(
          'State extraction failed',
          expect.any(Error),
        );
        consoleSpy.mockRestore();
      });
    });

    describe('DRIVE_LIST_DIRECTORY', () => {
      it('lists directory', async () => {
        const handler = getHandler(IPC_CHANNELS.DRIVE_LIST_DIRECTORY);
        (listDriveDirectory as Mock).mockResolvedValue([]);
        await handler({}, 'folderId');
        expect(listDriveDirectory).toHaveBeenCalledWith('folderId');
      });
    });

    describe('DRIVE_GET_PARENT', () => {
      it('gets parent', async () => {
        const handler = getHandler(IPC_CHANNELS.DRIVE_GET_PARENT);
        (getDriveParent as Mock).mockResolvedValue('parentId');
        const res = await handler({}, 'folderId');
        expect(getDriveParent).toHaveBeenCalledWith('folderId');
        expect(res).toBe('parentId');
      });

      it('returns null on error', async () => {
        const handler = getHandler(IPC_CHANNELS.DRIVE_GET_PARENT);
        (getDriveParent as Mock).mockRejectedValue(new Error('Fail'));
        const res = await handler({}, 'folderId');
        expect(res).toBeNull();
      });
    });

    describe('GET_HLS_STATUS', () => {
      it('should return session progress', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_HLS_STATUS);
        (validatePathAccess as Mock).mockResolvedValue(undefined);
        (generateSessionId as Mock).mockResolvedValue('test-session');
        const mockHlsManager = {
          getSessionProgress: vi.fn().mockReturnValue(50),
        };
        const HlsManagerModule = await import('../../../src/core/hls-manager');
        vi.spyOn(HlsManagerModule.HlsManager, 'getInstance').mockReturnValue(
          mockHlsManager as any,
        );

        const res = await handler({}, '/path/to.mp4');
        expect(res).toBe(50);
        expect(mockHlsManager.getSessionProgress).toHaveBeenCalledWith(
          'test-session',
        );
      });

      it('should handle errors', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_HLS_STATUS);
        (validatePathAccess as Mock).mockRejectedValue(
          new Error('Validation fail'),
        );
        const consoleSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const res = await handler({}, '/path/to.mp4');
        expect(res).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
      });
    });

    // --- From media-controller.recently-played.test.ts ---
    describe('GET_RECENTLY_PLAYED', () => {
      it('should register GET_RECENTLY_PLAYED handler', () => {
        expect(handleIpc).toHaveBeenCalledWith(
          IPC_CHANNELS.DB_GET_RECENTLY_PLAYED,
          expect.any(Function),
        );
      });

      it('handler should call getRecentlyPlayed with limit', async () => {
        const handler = getHandler(IPC_CHANNELS.DB_GET_RECENTLY_PLAYED);
        const limit = 25;
        await handler({}, limit);
        expect(getRecentlyPlayed).toHaveBeenCalledWith(limit);
      });
    });

    // --- From media-controller.security.test.ts ---
    describe('Security Check', () => {
      it('MEDIA_EXTRACT_METADATA should filter unauthorized paths', async () => {
        const handler = getHandler(IPC_CHANNELS.MEDIA_EXTRACT_METADATA);
        const inputPaths = ['/authorized/path.mp4', '/unauthorized/path.mp4'];
        const authorizedPaths = ['/authorized/path.mp4'];

        (filterAuthorizedPaths as Mock).mockResolvedValue(authorizedPaths);
        (extractAndSaveMetadata as Mock).mockResolvedValue(undefined);

        await handler({}, inputPaths);

        expect(filterAuthorizedPaths).toHaveBeenCalledWith(inputPaths);
        expect(extractAndSaveMetadata).toHaveBeenCalledWith(
          authorizedPaths,
          '/mock/ffmpeg',
          { forceCheck: true },
        );
      });
    });
  });

  describe('Missing FFmpeg', () => {
    beforeEach(async () => {
      vi.resetModules();
      vi.doMock('ffmpeg-static', () => ({ default: null }));
      const { registerMediaHandlers } =
        await import('../../../src/main/ipc/media-controller');
      registerMediaHandlers();
    });

    // --- From media-controller.ffmpeg.test.ts ---
    describe('GET_VIDEO_METADATA', () => {
      it('throws if ffmpeg missing for local file', async () => {
        const handler = getHandler(IPC_CHANNELS.GET_VIDEO_METADATA);
        (validatePathAccess as Mock).mockResolvedValue(undefined);

        await expect(handler({}, '/path/to.mp4')).rejects.toThrow(
          'FFmpeg binary not found',
        );
      });
    });

    describe('MEDIA_EXTRACT_METADATA', () => {
      it('skips extraction if ffmpeg missing', async () => {
        const handler = getHandler(IPC_CHANNELS.MEDIA_EXTRACT_METADATA);
        const consoleSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        await handler({}, ['/path']);

        expect(consoleSpy).toHaveBeenCalledWith(
          'FFmpeg not found, skipping metadata extraction',
        );
        consoleSpy.mockRestore();
      });
    });
  });
});
