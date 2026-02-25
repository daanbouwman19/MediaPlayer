import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaService } from '../../src/core/media-service';
import { MediaRepository } from '../../src/core/repositories/media-repository';

// Mock Repository
vi.mock('../../src/core/repositories/media-repository');

// Mock Worker Client to simulate scan results
const mockWorkerClient = {
  init: vi.fn(),
  sendMessage: vi.fn(),
  terminate: vi.fn(),
};

vi.mock('../../src/core/worker-client', () => {
  return {
    WorkerClient: class {
      init = mockWorkerClient.init;
      sendMessage = mockWorkerClient.sendMessage;
      terminate = mockWorkerClient.terminate;
    },
  };
});

// Mock Worker Factory
vi.mock('../../src/core/worker-factory', () => ({
  WorkerFactory: {
    getWorkerPath: vi
      .fn()
      .mockResolvedValue({ path: 'worker.js', options: {} }),
  },
}));

describe('Media Service Final Gap Fill', () => {
  let service: MediaService;
  let repo: MediaRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new MediaRepository();
    service = new MediaService(repo);

    // Default repo behaviors
    vi.mocked(repo.getMediaDirectories).mockResolvedValue([
      { path: '/dir', isActive: true },
    ] as any);
    vi.mocked(repo.getSetting).mockResolvedValue(null);
    vi.mocked(repo.getCachedAlbums).mockResolvedValue([]);
  });

  it('scanDiskForAlbumsAndCache: handles worker sending null', async () => {
    mockWorkerClient.sendMessage.mockResolvedValue(null);

    const albums = await service.scanDiskForAlbumsAndCache();
    expect(albums).toEqual([]);
    expect(repo.cacheAlbums).toHaveBeenCalledWith([]);
  });

  it('getAlbumsFromCacheOrDisk: returns scan result if cache empty', async () => {
    vi.mocked(repo.getCachedAlbums).mockResolvedValue([]);
    mockWorkerClient.sendMessage.mockResolvedValue([{ id: 'scan' }]);

    const albums = await service.getAlbumsFromCacheOrDisk();
    expect(albums[0].id).toBe('scan');
  });

  it('getAlbumsWithViewCounts: handles empty albums list', async () => {
    vi.mocked(repo.getCachedAlbums).mockResolvedValue([]);
    mockWorkerClient.sendMessage.mockResolvedValue([]); // Scan returns empty

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

    vi.mocked(repo.getCachedAlbums).mockResolvedValue(deepAlbums as any);
    // @ts-ignore
    vi.mocked(repo.getAlbumStats).mockResolvedValue([
      {
        file_path: '/1.mp4',
        view_count: 10,
        duration: 100,
        rating: null,
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
