import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import { Worker } from 'worker_threads';
import * as database from '../../src/core/database';
import * as mediaHandler from '../../src/core/media-handler';
import * as ffmpegUtils from '../../src/core/utils/ffmpeg-utils';
import { isDrivePath } from '../../src/core/media-utils';
import {
  scanDiskForAlbumsAndCache,
  getAlbumsWithViewCountsAfterScan,
  getAlbumsWithViewCounts,
  extractAndSaveMetadata,
} from '../../src/core/media-service';
import { METADATA_VERIFICATION_THRESHOLD } from '../../src/core/constants';

// --- Mocks ---

// 1. Database
vi.mock('../../src/core/database', () => ({
  getMediaDirectories: vi.fn(),
  cacheAlbums: vi.fn(),
  getCachedAlbums: vi.fn(),
  getAllMetadataAndStats: vi.fn(),
  getAlbumStats: vi.fn(),
  getAllMetadata: vi.fn(),
  getAllMetadataVerification: vi.fn(),
  getPendingMetadata: vi.fn(),
  bulkUpsertMetadata: vi.fn(),
  getMetadata: vi.fn(),
  getSetting: vi.fn(),
  filterProcessingNeeded: vi.fn(),
}));

// 2. Other Core Modules
vi.mock('../../src/core/media-scanner');
vi.mock('../../src/core/media-handler');
vi.mock('../../src/core/media-utils', () => ({
  isDrivePath: vi.fn(),
  getMimeType: () => 'video/mp4',
  getVlcPath: vi.fn(),
}));
vi.mock('../../src/core/utils/ffmpeg-utils', () => ({
  getFFmpegDuration: vi.fn(),
}));

// 3. FS
vi.mock('fs/promises', () => {
  const stat = vi.fn();
  return {
    stat,
    default: { stat },
  };
});

// 4. Shared State for Worker Mock
const sharedState = vi.hoisted(() => ({
  lastWorker: null as any,
  isPackaged: false,
  postMessageCallback: null as ((msg: any) => void) | null,
}));

// 5. Electron
vi.mock('electron', () => {
  return {
    app: {
      get isPackaged() {
        return sharedState.isPackaged;
      },
      getPath: vi.fn().mockReturnValue('/tmp'),
    },
    default: {
      get app() {
        return {
          get isPackaged() {
            return sharedState.isPackaged;
          },
          getPath: vi.fn().mockReturnValue('/tmp'),
        };
      },
    },
    __esModule: true,
  };
});

// 6. Worker Threads
vi.mock('worker_threads', () => {
  const Worker = vi.fn(function (this: any) {
    this.on = vi.fn();
    this.postMessage = vi.fn((msg) => {
      if (sharedState.postMessageCallback) {
        sharedState.postMessageCallback(msg);
      }
    });
    this.terminate = vi.fn().mockResolvedValue(0);
    this.removeAllListeners = vi.fn();
    sharedState.lastWorker = this;
  });
  return {
    Worker,
    default: { Worker },
    __esModule: true,
  };
});

// Helper to simulate worker reply
const mockWorkerReply = async (
  action: () => Promise<any>,
  replyData: any,
  success = true,
) => {
  let msgId: string | undefined;
  const postMessagePromise = new Promise<void>((resolve) => {
    sharedState.postMessageCallback = (msg: any) => {
      msgId = msg.id;
      resolve();
    };
  });

  const promise = action();

  // Wait for worker to receive message
  await postMessagePromise;

  // Find the 'message' listener attached by WorkerClient
  const onMessage = sharedState.lastWorker.on.mock.calls.find(
    (c: any) => c[0] === 'message',
  )?.[1];

  if (onMessage && msgId !== undefined) {
    onMessage({
      id: msgId,
      result: success
        ? { success: true, data: replyData }
        : { success: false, error: replyData },
    });
  }

  return promise;
};

describe('MediaService Combined Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();

    // Default DB Mocks
    vi.mocked(database.getMetadata).mockResolvedValue({});
    vi.mocked(database.getAllMetadata).mockResolvedValue({});
    vi.mocked(database.getAllMetadataAndStats).mockResolvedValue([]);
    vi.mocked(database.getAlbumStats).mockResolvedValue([]);
    vi.mocked(database.getAllMetadataVerification).mockResolvedValue({});
    vi.mocked(database.getCachedAlbums).mockResolvedValue([]);
    vi.mocked(database.getPendingMetadata).mockResolvedValue([]);
    vi.mocked(database.filterProcessingNeeded).mockImplementation(
      async (paths) => paths,
    );
    vi.mocked(database.getMediaDirectories).mockResolvedValue([
      { path: '/dir', isActive: true },
    ] as any);

    // Default FS Mock
    vi.mocked(fs.stat).mockResolvedValue({
      size: 1024,
      birthtime: new Date(),
      mtime: new Date(),
      isFile: () => true,
    } as any);

    // Default Utils Mock
    vi.mocked(isDrivePath).mockImplementation((path) =>
      path.startsWith('gdrive://'),
    );
    vi.mocked(ffmpegUtils.getFFmpegDuration).mockResolvedValue(100);

    sharedState.lastWorker = null;
    sharedState.isPackaged = false;
    sharedState.postMessageCallback = null;

    // Stub process.versions.electron to undefined by default
    vi.stubGlobal('process', {
      ...process,
      versions: { ...process.versions, electron: undefined },
    });
  });

  // --- Scan & Cache (Integration) ---
  describe('Scan & Cache', () => {
    it('returns empty list if no active directories', async () => {
      vi.mocked(database.getMediaDirectories).mockResolvedValue([
        { path: '/dir1', isActive: false },
      ] as any);

      const result = await scanDiskForAlbumsAndCache();
      expect(result).toEqual([]);
      expect(database.cacheAlbums).toHaveBeenCalledWith([]);
      expect(Worker).not.toHaveBeenCalled();
    });

    it('uses correct worker path in packaged app', async () => {
      vi.stubGlobal('process', {
        ...process,
        versions: { ...process.versions, electron: '30.0.0' },
      });
      sharedState.isPackaged = true;

      await mockWorkerReply(() => scanDiskForAlbumsAndCache(), []);

      expect(vi.mocked(Worker)).toHaveBeenCalledWith(
        expect.stringMatching(/scan-worker\.js$/),
        undefined,
      );
    });

    it('handles worker SCAN_ERROR', async () => {
      await expect(
        mockWorkerReply(
          () => scanDiskForAlbumsAndCache(),
          'Worker error',
          false,
        ),
      ).rejects.toThrow('Worker error');
    });

    it('triggers background metadata extraction and handles its failure', async () => {
      vi.mocked(database.getPendingMetadata).mockRejectedValue(
        new Error('Background error'),
      );
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const albums = [{ id: 1, textures: [{ path: '/v.mp4' }] }];

      await mockWorkerReply(() => scanDiskForAlbumsAndCache('/ffmpeg'), albums);

      await vi.waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Background metadata extraction failed'),
          expect.any(Error),
        );
      });
      consoleErrorSpy.mockRestore();
    });
  });

  // --- Filter Optimization ---
  describe('Filter Optimization', () => {
    it('should call filterProcessingNeeded with all found paths', async () => {
      const albums = [
        {
          id: '1',
          textures: [{ path: '/a.mp4' }, { path: '/b.mp4' }],
          children: [{ id: '2', textures: [{ path: '/c.mp4' }], children: [] }],
        },
      ];

      await mockWorkerReply(() => scanDiskForAlbumsAndCache('/ffmpeg'), albums);

      await vi.waitFor(() => {
        expect(database.filterProcessingNeeded).toHaveBeenCalledWith(
          expect.arrayContaining(['/a.mp4', '/b.mp4', '/c.mp4']),
        );
      });
    });

    it('should only pass needed paths to extractAndSaveMetadata', async () => {
      const albums = [
        {
          id: '1',
          textures: [{ path: '/success.mp4' }, { path: '/new.mp4' }],
          children: [],
        },
      ];

      vi.mocked(database.filterProcessingNeeded).mockResolvedValue([
        '/new.mp4',
      ]);

      await mockWorkerReply(() => scanDiskForAlbumsAndCache('/ffmpeg'), albums);

      await vi.waitFor(() => {
        expect(database.getMetadata).toHaveBeenCalledWith(
          expect.arrayContaining(['/new.mp4']),
        );
        expect(database.getMetadata).not.toHaveBeenCalledWith(
          expect.arrayContaining(['/success.mp4']),
        );
      });
    });
  });

  // --- Metadata Optimization ---
  describe('Metadata Optimization', () => {
    it(`should call getAllMetadataVerification when processing > ${METADATA_VERIFICATION_THRESHOLD} files`, async () => {
      const filePaths = Array.from(
        { length: METADATA_VERIFICATION_THRESHOLD + 1 },
        (_, i) => `/path/${i}.mp4`,
      );
      await extractAndSaveMetadata(filePaths, 'ffmpeg');

      expect(database.getAllMetadataVerification).toHaveBeenCalled();
      expect(database.getMetadata).not.toHaveBeenCalled();
    });

    it(`should call getMetadata when processing <= ${METADATA_VERIFICATION_THRESHOLD} files`, async () => {
      const filePaths = Array.from(
        { length: METADATA_VERIFICATION_THRESHOLD },
        (_, i) => `/path/${i}.mp4`,
      );
      await extractAndSaveMetadata(filePaths, 'ffmpeg');

      expect(database.getAllMetadataVerification).not.toHaveBeenCalled();
      expect(database.getMetadata).toHaveBeenCalled();
    });

    it('should skip fs.stat if metadata exists and forceCheck is false', async () => {
      const filePath = '/existing.mp4';
      vi.mocked(database.getMetadata).mockResolvedValue({
        [filePath]: {
          status: 'success',
          size: 1024,
          createdAt: new Date().toISOString(),
        },
      });

      // Ensure stat matches db
      vi.mocked(fs.stat).mockResolvedValue({
        size: 1024,
        birthtime: new Date(),
      } as any);

      await extractAndSaveMetadata([filePath], 'ffmpeg', { forceCheck: false });

      expect(fs.stat).not.toHaveBeenCalled();
    });
  });

  // --- Mutation ---
  describe('Mutation & Enrichment', () => {
    it('should mutate albums in-place', async () => {
      const mockAlbum = {
        id: 'album-1',
        name: 'Test Album',
        textures: [{ name: 'video.mp4', path: '/video.mp4', rating: 0 } as any],
        children: [
          {
            id: 'child-1',
            name: 'Child Album',
            textures: [{ name: 'image.jpg', path: '/image.jpg' }],
            children: [],
          },
        ],
      };

      vi.mocked(database.getAlbumStats).mockResolvedValue([
        {
          file_path: '/video.mp4',
          view_count: 5,
          duration: 120,
          rating: 4,
        },
      ]);

      const result = await mockWorkerReply(
        () => getAlbumsWithViewCountsAfterScan(),
        [mockAlbum],
      );

      // Check Referential Equality (Mutation)
      expect(result[0]).toBe(mockAlbum);

      expect(mockAlbum.textures[0].viewCount).toBe(5);
      expect(mockAlbum.textures[0].duration).toBe(120);
      expect(mockAlbum.textures[0].rating).toBe(4);

      expect(result[0].children[0].textures[0].viewCount).toBe(0);
    });
  });

  // --- Recursion ---
  describe('Recursion', () => {
    it('should attach view counts and metadata to nested files', async () => {
      const nestedAlbum = {
        id: 'child',
        name: 'Child',
        textures: [{ path: '/child/file.mp4', name: 'file.mp4' }],
        children: [],
      };
      const rootAlbum = {
        id: 'root',
        name: 'Root',
        textures: [],
        children: [nestedAlbum],
      };

      vi.mocked(database.getCachedAlbums).mockResolvedValue([rootAlbum] as any);
      vi.mocked(database.getAlbumStats).mockResolvedValue([
        {
          file_path: '/child/file.mp4',
          view_count: 42,
          duration: 120,
          rating: null,
        },
      ]);

      const result = await getAlbumsWithViewCounts();

      expect(result[0].children[0].textures[0].viewCount).toBe(42);
      expect(result[0].children[0].textures[0].duration).toBe(120);
    });
  });

  // --- Performance ---
  describe('Performance', () => {
    it('should call fs.stat ONCE for a local video file (redundant check removed)', async () => {
      const filePath = '/path/to/video.mp4';
      // Ensure not in DB
      vi.mocked(database.getMetadata).mockResolvedValue({});
      // Mock getVideoDuration to return a valid result so we can verify it was called
      vi.mocked(mediaHandler.getVideoDuration).mockResolvedValue({
        duration: 100,
      });

      await extractAndSaveMetadata([filePath], 'ffmpeg');

      expect(fs.stat).toHaveBeenCalledTimes(1);
      // Verify we call the handler for duration, instead of checking internal ffmpeg calls
      // since media-handler is mocked.
      expect(mediaHandler.getVideoDuration).toHaveBeenCalled();
    });

    it('should call fs.stat ONCE for image files and SKIP video duration check', async () => {
      const filePath = '/path/to/image.jpg';
      vi.mocked(database.getMetadata).mockResolvedValue({});

      await extractAndSaveMetadata([filePath], 'ffmpeg');

      expect(fs.stat).toHaveBeenCalledTimes(1);
      expect(mediaHandler.getVideoDuration).not.toHaveBeenCalled();
    });
  });

  // --- Coverage (from tests/main/media-service.coverage.test.ts) ---
  describe('Coverage & Edge Cases', () => {
    it('extractAndSaveMetadata handles fs.stat errors gracefully', async () => {
      vi.mocked(fs.stat).mockRejectedValueOnce(new Error('File not found'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const testFile = '/path/to/video.mp4';

      await extractAndSaveMetadata([testFile], 'ffmpeg');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error extracting metadata'),
        expect.any(Error),
      );
      expect(database.bulkUpsertMetadata).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: testFile,
            status: 'failed',
          }),
        ]),
      );
      consoleSpy.mockRestore();
    });

    it('extractAndSaveMetadata handles upsertMetadata errors', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 1000,
        birthtime: new Date(),
      } as any);
      vi.mocked(mediaHandler.getVideoDuration).mockResolvedValue({
        duration: 60,
      });
      vi.mocked(database.bulkUpsertMetadata).mockRejectedValue(
        new Error('DB Error'),
      );

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const testFile = '/path/to/video.mp4';

      await extractAndSaveMetadata([testFile], 'ffmpeg');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to bulk upsert metadata'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('extractAndSaveMetadata saves duration if available', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 1000,
        birthtime: new Date('2023-01-01'),
      } as any);
      vi.mocked(mediaHandler.getVideoDuration).mockResolvedValue({
        duration: 120,
      });
      const testFile = '/path/to/video.mp4';

      await extractAndSaveMetadata([testFile], 'ffmpeg');

      expect(database.bulkUpsertMetadata).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: testFile,
            duration: 120,
            size: 1000,
          }),
        ]),
      );
    });

    it('extractAndSaveMetadata skips duration if unavailable', async () => {
      vi.mocked(fs.stat).mockResolvedValue({
        size: 500,
        birthtime: new Date('2023-01-01'),
      } as any);
      vi.mocked(mediaHandler.getVideoDuration).mockResolvedValue({
        error: 'Not video',
      });
      const testFile = '/path/to/video.mp4';

      await extractAndSaveMetadata([testFile], 'ffmpeg');

      expect(database.bulkUpsertMetadata).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: testFile,
            size: 500,
          }),
        ]),
      );

      // Ensure duration is NOT present in the payload object for this file
      const call = vi
        .mocked(database.bulkUpsertMetadata)
        .mock.calls.find((args) =>
          args[0].some((item: any) => item.filePath === testFile),
        );
      const item = call?.[0].find((item: any) => item.filePath === testFile);
      expect(item).toBeDefined();
      expect(item).not.toHaveProperty('duration');
    });
  });
});
