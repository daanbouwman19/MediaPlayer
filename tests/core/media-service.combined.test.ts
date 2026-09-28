import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { MediaService } from '../../src/core/media/media-service';
import { InMemoryMediaRepository } from '../fakes/in-memory-media-repository';
import { METADATA_VERIFICATION_THRESHOLD } from '../../src/core/media/constants';
import * as encryption from '../../src/core/auth/encryption';

vi.mock('../../src/core/auth/encryption', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

const DRIVE_DIR = 'gdrive://folder';

describe('MediaService Combined Tests (DI Refactored)', () => {
  let service: MediaService;
  let repo: InMemoryMediaRepository;
  let mockFs: { stat: any };
  let mockWorker: { runScan: any };
  let mockMediaHandler: { getVideoDuration: any; getFileMetadata: any };

  /** Caches `albums` the way a real scan does (tree + source stamp). */
  const seedCacheByScan = async (albums: any[]) => {
    repo.setMediaDirectories([
      { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
    ]);
    mockWorker.runScan.mockResolvedValueOnce(albums);
    await service.scanDiskForAlbumsAndCache();
    mockWorker.runScan.mockClear();
  };

  beforeEach(() => {
    vi.clearAllMocks();

    repo = new InMemoryMediaRepository();
    mockFs = {
      stat: vi.fn().mockResolvedValue({
        size: 1024,
        birthtime: new Date(),
      }),
    };
    mockWorker = {
      runScan: vi.fn().mockResolvedValue([]),
    };
    mockMediaHandler = {
      getVideoDuration: vi.fn().mockResolvedValue({ duration: 100 }),
      getFileMetadata: vi.fn(),
    };

    service = new MediaService(
      repo,
      mockFs as any,
      mockWorker as any,
      mockMediaHandler as any,
    );
  });

  // --- Scan & Cache ---
  describe('Scan & Cache', () => {
    it('returns empty list if no active directories', async () => {
      repo.setMediaDirectories([
        {
          id: '1',
          path: '/dir1',
          type: 'local',
          name: 'dir1',
          isActive: false,
        },
      ]);

      const result = await service.scanDiskForAlbumsAndCache();
      expect(result).toEqual([]);
      expect(mockWorker.runScan).not.toHaveBeenCalled();
    });

    it('triggers worker scan with correct params', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
        {
          id: '2',
          path: DRIVE_DIR,
          type: 'google_drive',
          name: 'd',
          isActive: true,
        },
      ]);
      repo.setSetting('google_tokens', 'ENCRYPTED_TOKENS');
      vi.mocked(encryption.decrypt).mockReturnValue(
        JSON.stringify({ access_token: 'abc' }),
      );

      await service.scanDiskForAlbumsAndCache();
      expect(mockWorker.runScan).toHaveBeenCalledWith({
        directories: ['/dir', DRIVE_DIR],
        tokens: { access_token: 'abc' },
      });
    });

    it('does not read or send Google tokens for a purely local scan', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      repo.setSetting('google_tokens', 'ENCRYPTED_TOKENS');

      await service.scanDiskForAlbumsAndCache();

      expect(encryption.decrypt).not.toHaveBeenCalled();
      expect(mockWorker.runScan).toHaveBeenCalledWith({
        directories: ['/dir'],
        tokens: null,
      });
    });

    it('handles google tokens decryption failure', async () => {
      repo.setMediaDirectories([
        {
          id: '2',
          path: DRIVE_DIR,
          type: 'google_drive',
          name: 'd',
          isActive: true,
        },
      ]);
      repo.setSetting('google_tokens', 'BAD_TOKENS');
      vi.mocked(encryption.decrypt).mockReturnValue(null);

      await service.scanDiskForAlbumsAndCache();
      expect(mockWorker.runScan).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: null,
        }),
      );
    });

    it('handles google tokens JSON parse failure', async () => {
      repo.setMediaDirectories([
        {
          id: '2',
          path: DRIVE_DIR,
          type: 'google_drive',
          name: 'd',
          isActive: true,
        },
      ]);
      repo.setSetting('google_tokens', 'BAD_JSON');
      vi.mocked(encryption.decrypt).mockReturnValue('invalid-json');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await service.scanDiskForAlbumsAndCache();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch google tokens'),
        expect.any(Error),
      );
      expect(mockWorker.runScan).toHaveBeenCalledWith(
        expect.objectContaining({
          tokens: null,
        }),
      );
      consoleSpy.mockRestore();
    });

    it('handles worker errors', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      mockWorker.runScan.mockRejectedValue(new Error('Worker leak'));

      await expect(service.scanDiskForAlbumsAndCache()).rejects.toThrow(
        'Worker leak',
      );
    });

    it('returns empty array when worker returns null albums', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      mockWorker.runScan.mockResolvedValue(null);

      const result = await service.scanDiskForAlbumsAndCache();
      expect(result).toEqual([]);
    });
  });

  // --- Filter Optimization ---
  describe('Filter Optimization', () => {
    it('should only pass needed paths to extractAndSaveMetadata', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      const albums = [
        {
          id: '1',
          textures: [{ path: '/success.mp4' }, { path: '/new.mp4' }],
          children: [],
        },
      ];
      mockWorker.runScan.mockResolvedValue(albums);

      // Setup repo state
      await repo.bulkUpsertMetadata([
        {
          filePath: '/success.mp4',
          status: 'success',
          duration: 10,
          size: 100,
          createdAt: '',
        },
      ]);

      const spy = vi.spyOn(repo, 'getMetadata');

      await service.scanDiskForAlbumsAndCache('/ffmpeg');

      // extractAndSaveMetadata is triggered in background.
      // We use repo.filterProcessingNeeded which should only return /new.mp4
      await vi.waitFor(() => {
        expect(spy).toHaveBeenCalledWith(expect.arrayContaining(['/new.mp4']));
        expect(spy).not.toHaveBeenCalledWith(
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
      const spy = vi.spyOn(repo, 'getAllMetadataVerification');
      await service.extractAndSaveMetadata(filePaths, 'ffmpeg');

      expect(spy).toHaveBeenCalled();
    });

    it('should skip fs.stat if metadata exists and matches stats', async () => {
      const filePath = '/existing.mp4';
      const now = new Date();
      await repo.bulkUpsertMetadata([
        {
          filePath,
          status: 'success',
          duration: 45,
          size: 1024,
          createdAt: now.toISOString(),
        },
      ]);

      mockFs.stat.mockResolvedValue({
        size: 1024,
        birthtime: now,
      });

      await service.extractAndSaveMetadata([filePath], 'ffmpeg', {
        forceCheck: false,
      });

      expect(mockFs.stat).not.toHaveBeenCalled();
    });

    it('re-probes an unchanged success video that has no duration (legacy row)', async () => {
      const filePath = '/legacy.mp4';
      const now = new Date();
      await repo.bulkUpsertMetadata([
        {
          filePath,
          status: 'success',
          size: 1024,
          createdAt: now.toISOString(),
        },
      ]);
      mockFs.stat.mockResolvedValue({ size: 1024, birthtime: now });
      mockMediaHandler.getVideoDuration.mockResolvedValue({ duration: 33 });

      await service.extractAndSaveMetadata([filePath], 'ffmpeg');

      expect(mockMediaHandler.getVideoDuration).toHaveBeenCalledWith(
        filePath,
        'ffmpeg',
      );
      expect((await repo.getMetadata([filePath]))[filePath]).toMatchObject({
        status: 'success',
        duration: 33,
      });
    });

    it('reads drive files from provider metadata instead of stat/ffmpeg', async () => {
      const filePath = 'gdrive://video-id';
      mockMediaHandler.getFileMetadata.mockResolvedValue({
        size: 2048,
        mimeType: 'video/mp4',
        lastModified: new Date('2024-01-02T03:04:05.000Z'),
        duration: 42,
      });

      await service.extractAndSaveMetadata([filePath], 'ffmpeg');

      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(mockMediaHandler.getVideoDuration).not.toHaveBeenCalled();
      const meta = await repo.getMetadata([filePath]);
      expect(meta[filePath]).toEqual({
        status: 'success',
        size: 2048,
        createdAt: '2024-01-02T03:04:05.000Z',
        duration: 42,
      });
    });
  });

  // --- Mutation & Enrichment ---
  describe('Mutation & Enrichment', () => {
    it('should mutate albums in-place with stats', async () => {
      const mockAlbum = {
        id: 'album-1',
        name: 'Test Album',
        textures: [{ name: 'video.mp4', path: '/video.mp4', rating: 0 } as any],
        children: null as any, // Testing child normalization branch
      };

      repo.setAllMetadataAndStats([
        {
          file_path: '/video.mp4',
          file_path_hash: 'hash',
          view_count: 5,
          duration: 120,
          rating: 4,
          created_at: null,
          size: null,
          last_viewed: null,
        },
      ]);

      await seedCacheByScan([mockAlbum]);

      const result = await service.getAlbumsWithViewCounts();

      expect(result[0]).toBe(mockAlbum);
      expect(mockAlbum.textures[0].viewCount).toBe(5);
      expect(mockAlbum.textures[0].duration).toBe(120);
      expect(mockAlbum.textures[0].rating).toBe(4);
      expect(mockAlbum.children).toEqual([]);
    });

    it('should preserve texture rating if stats rating is null', async () => {
      const mockAlbum = {
        id: 'album-1',
        name: 'Test Album',
        textures: [{ name: 'video.mp4', path: '/video.mp4', rating: 3 } as any],
        children: [],
      };

      repo.setAllMetadataAndStats([
        {
          file_path: '/video.mp4',
          file_path_hash: 'hash',
          view_count: 5,
          duration: null as any,
          rating: null as any,
          created_at: null,
          size: null,
          last_viewed: null,
        },
      ]);

      await seedCacheByScan([mockAlbum]);
      const result = await service.getAlbumsWithViewCounts();
      expect(result[0].textures[0].rating).toBe(3);
      expect(result[0].textures[0].duration).toBeUndefined();
    });
  });

  // --- Coverage & Edge Cases ---
  describe('Coverage & Edge Cases', () => {
    it('extractAndSaveMetadata handles fs.stat errors gracefully', async () => {
      mockFs.stat.mockRejectedValue(new Error('File not found'));
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const testFile = '/path/to/video.mp4';

      await service.extractAndSaveMetadata([testFile], 'ffmpeg');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error extracting metadata'),
        expect.any(Error),
      );
      const meta = await repo.getMetadata([testFile]);
      expect(meta[testFile].status).toBe('failed');
      consoleSpy.mockRestore();
    });

    it('extractAndSaveMetadata handles upsert errors', async () => {
      vi.spyOn(repo, 'bulkUpsertMetadata').mockRejectedValue(
        new Error('DB Error'),
      );
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const testFile = '/path/to/video.mp4';

      await service.extractAndSaveMetadata([testFile], 'ffmpeg');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to bulk upsert metadata'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('getAlbumsFromCacheOrDisk falls back to disk scan if cache empty', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      mockWorker.runScan.mockResolvedValue([
        { id: '1', textures: [], children: [] },
      ]);

      const result = await service.getAlbumsFromCacheOrDisk();
      expect(mockWorker.runScan).toHaveBeenCalled();
      expect(result.length).toBe(1);
    });

    it('getAlbumsWithViewCountsAfterScan handles empty results', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      mockWorker.runScan.mockResolvedValue([]);

      const result = await service.getAlbumsWithViewCountsAfterScan();
      expect(result).toEqual([]);
    });

    it('calls getMetadata even if path is empty', async () => {
      const spy = vi.spyOn(repo, 'getMetadata');
      await service.extractAndSaveMetadata([''], 'ffmpeg');
      expect(spy).toHaveBeenCalledWith(['']);
    });
  });
});
