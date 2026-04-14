import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaService } from '../../src/core/media-service';
import { InMemoryMediaRepository } from '../fakes/in-memory-media-repository';
import { METADATA_VERIFICATION_THRESHOLD } from '../../src/core/constants';
import * as encryption from '../../src/core/utils/encryption';

vi.mock('../../src/core/utils/encryption', () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));

describe('MediaService Combined Tests (DI Refactored)', () => {
  let service: MediaService;
  let repo: InMemoryMediaRepository;
  let mockFs: { stat: any };
  let mockWorker: { runScan: any };
  let mockMediaHandler: { getVideoDuration: any };

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
      ]);
      repo.setSetting('google_tokens', 'ENCRYPTED_TOKENS');
      vi.mocked(encryption.decrypt).mockReturnValue(JSON.stringify({ access_token: 'abc' }));

      await service.scanDiskForAlbumsAndCache();
      expect(mockWorker.runScan).toHaveBeenCalledWith(expect.objectContaining({
        tokens: { access_token: 'abc' }
      }));
    });

    it('handles google tokens decryption failure', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      repo.setSetting('google_tokens', 'BAD_TOKENS');
      vi.mocked(encryption.decrypt).mockReturnValue(null);

      await service.scanDiskForAlbumsAndCache();
      expect(mockWorker.runScan).toHaveBeenCalledWith(expect.objectContaining({
        tokens: null
      }));
    });

    it('handles google tokens JSON parse failure', async () => {
      repo.setMediaDirectories([
        { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
      ]);
      repo.setSetting('google_tokens', 'BAD_JSON');
      vi.mocked(encryption.decrypt).mockReturnValue('invalid-json');
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await service.scanDiskForAlbumsAndCache();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch google tokens'), expect.any(Error));
      expect(mockWorker.runScan).toHaveBeenCalledWith(expect.objectContaining({
        tokens: null
      }));
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

    it('should skip drive paths', async () => {
      const filePath = 'gdrive://file.mp4';
      const spy = vi.spyOn(repo, 'bulkUpsertMetadata');
      await service.extractAndSaveMetadata([filePath], 'ffmpeg');
      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
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

      await repo.cacheAlbums([mockAlbum as any]);

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

      await repo.cacheAlbums([mockAlbum as any]);
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
      repo.setMediaDirectories([{ id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true }]);
      mockWorker.runScan.mockResolvedValue([{ id: '1', textures: [], children: [] }]);
      
      const result = await service.getAlbumsFromCacheOrDisk();
      expect(mockWorker.runScan).toHaveBeenCalled();
      expect(result.length).toBe(1);
    });

    it('getAlbumsWithViewCountsAfterScan handles empty results', async () => {
      repo.setMediaDirectories([{ id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true }]);
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
