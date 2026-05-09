import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { api } from '@/api';

// Mock api
vi.mock('@/api', () => ({
  api: {
    getAlbumsWithViewCounts: vi.fn(),
    getMediaDirectories: vi.fn(),
    getSupportedExtensions: vi.fn(),
    getSmartPlaylists: vi.fn(),
    getMediaUrlGenerator: vi.fn(),
    getThumbnailUrlGenerator: vi.fn(),
  },
}));

describe('useLibraryStore', () => {
  let store: ReturnType<typeof useLibraryStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    // Clear localStorage
    localStorage.clear();
    store = useLibraryStore();
  });

  it('should initialize with default values', () => {
    expect(store.allAlbums).toEqual([]);
    expect(store.mediaDirectories).toEqual([]);
    expect(store.isScanning).toBe(false);
  });

  it('should load initial data correctly', async () => {
    const albums = [{ id: '1', name: 'Test Album', textures: [] }];
    const dirs = [{ path: '/test', isActive: true }];
    const exts = { images: ['.jpg'], videos: ['.mp4'], all: ['.jpg', '.mp4'] };
    const playlists: any[] = [];

    vi.mocked(api.getAlbumsWithViewCounts).mockResolvedValue(albums as any);
    vi.mocked(api.getMediaDirectories).mockResolvedValue(dirs as any);
    vi.mocked(api.getSupportedExtensions).mockResolvedValue(exts);
    vi.mocked(api.getSmartPlaylists).mockResolvedValue(playlists);

    await store.loadInitialData();

    expect(store.allAlbums).toEqual(albums);
    expect(store.mediaDirectories).toEqual(dirs);
    expect(store.supportedExtensions).toEqual(exts);
    expect(store.imageExtensionsSet.has('.jpg')).toBe(true);
    expect(store.videoExtensionsSet.has('.mp4')).toBe(true);
  });

  it('should handle loadInitialData errors gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(api.getAlbumsWithViewCounts).mockRejectedValue(
      new Error('Load error'),
    );

    await store.loadInitialData();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[useLibraryStore] Error during initial load:',
      expect.any(Error),
    );
  });

  it('should select all albums recursively', () => {
    const albums = [
      { id: '1', name: 'A1', children: [{ id: '1.1', name: 'A1.1' }] },
      { id: '2', name: 'A2' },
    ] as any;
    store.allAlbums = albums;

    store.selectAllAlbumsRecursively(albums);

    expect(store.albumsSelectedForSlideshow['1']).toBe(true);
    expect(store.albumsSelectedForSlideshow['1.1']).toBe(true);
    expect(store.albumsSelectedForSlideshow['2']).toBe(true);
  });

  it('should reset library state', () => {
    store.globalMediaPoolForSelection = [{ path: 'test' } as any];
    store.albumsSelectedForSlideshow = { '1': true };

    store.resetLibraryState();

    expect(store.globalMediaPoolForSelection).toEqual([]);
    expect(store.albumsSelectedForSlideshow).toEqual({});
  });

  it('should clear only media pool', () => {
    store.globalMediaPoolForSelection = [{ path: 'test' } as any];
    store.albumsSelectedForSlideshow = { '1': true };

    store.clearMediaPool();

    expect(store.globalMediaPoolForSelection).toEqual([]);
    expect(store.albumsSelectedForSlideshow).toEqual({ '1': true });
  });
});
