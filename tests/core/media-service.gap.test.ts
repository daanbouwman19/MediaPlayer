import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaService } from '../../src/core/media-service';
import { InMemoryMediaRepository } from '../fakes/in-memory-media-repository';

describe('Media Service Final Gap Fill (DI Refactored)', () => {
  let service: MediaService;
  let repo: InMemoryMediaRepository;
  let mockFs: { stat: any };
  let mockWorker: { runScan: any };
  let mockMediaHandler: { getVideoDuration: any };

  beforeEach(() => {
    vi.clearAllMocks();

    repo = new InMemoryMediaRepository();
    mockFs = {
      stat: vi.fn().mockResolvedValue({ size: 1024, birthtime: new Date() }),
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

  it('scanDiskForAlbumsAndCache: handles worker sending null', async () => {
    repo.setMediaDirectories([
      { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
    ]);
    mockWorker.runScan.mockResolvedValue(null);

    const albums = await service.scanDiskForAlbumsAndCache();
    expect(albums).toEqual([]);
  });

  it('getAlbumsFromCacheOrDisk: returns scan result if cache empty', async () => {
    repo.setMediaDirectories([
      { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
    ]);
    mockWorker.runScan.mockResolvedValue([{ id: 'scan' }]);

    const albums = await service.getAlbumsFromCacheOrDisk();
    expect(albums[0].id).toBe('scan');
  });

  it('getAlbumsWithViewCounts: handles empty albums list', async () => {
    repo.setMediaDirectories([
      { id: '1', path: '/dir', type: 'local', name: 'dir', isActive: true },
    ]);
    mockWorker.runScan.mockResolvedValue([]); // Scan returns empty

    const albums = await service.getAlbumsWithViewCounts();
    expect(albums).toEqual([]);
  });

  it('enrichAlbumsWithStats: handles deep nesting and missing metadata', async () => {
    const deepAlbums = [
      {
        id: '1',
        textures: [{ path: '/1.mp4' }],
        children: [
          {
            id: '2',
            textures: [{ path: '/2.mp4', rating: 5 }], // has rating
            children: [],
          },
        ],
      },
    ];

    await repo.cacheAlbums(deepAlbums as any);
    repo.setAllMetadataAndStats([
      {
        file_path: '/1.mp4',
        file_path_hash: 'hash',
        view_count: 10,
        duration: 100,
        rating: null,
        created_at: null,
        size: null,
        last_viewed: null,
      },
    ]);

    const result = await service.getAlbumsWithViewCounts();

    const t1 = result[0].textures[0];
    const t2 = result[0].children[0].textures[0];

    expect(t1.viewCount).toBe(10);
    expect(t1.duration).toBe(100);

    expect(t2.viewCount).toBe(0); // Default
    expect(t2.rating).toBe(5); // Preserved from texture
    expect(t2.duration).toBeUndefined();
  });
});
