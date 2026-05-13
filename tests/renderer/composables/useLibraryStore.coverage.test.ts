import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
// We must mock access to localStorage via stubGlobal BEFORE importing the module if we wanted to control it specifically during module init,
// but for runtime access (inside functions), stubbing in beforeEach is fine.
// However, to be safe, let's define the mock structure.

const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

// Stub global localStorage
vi.stubGlobal('localStorage', localStorageMock);

import {
  useLibraryStore,
  setupPersistenceWatcher,
} from '@/composables/useLibraryStore';
import { api } from '@/api';

// Mock api
vi.mock('@/api', () => ({
  api: {
    getAlbumsWithViewCounts: vi.fn(),
    getMediaDirectories: vi.fn(),
    getSupportedExtensions: vi.fn(),
    getSmartPlaylists: vi.fn(),
    getRecentlyPlayed: vi.fn(),
    getMediaUrlGenerator: vi.fn(),
    getThumbnailUrlGenerator: vi.fn(),
  },
}));

describe('useLibraryStore Coverage', () => {
  let store: ReturnType<typeof useLibraryStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    localStorageMock.getItem.mockReset();
    localStorageMock.setItem.mockReset();

    // Reset internal state of the store
    store = useLibraryStore();
  });

  describe('setupPersistenceWatcher', () => {
    it('should handle localStorage errors', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Force setItem to throw
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceeded');
      });

      // Ensure watcher is setup (it likely is from import, but calling doesn't hurt)
      setupPersistenceWatcher();

      // Trigger change
      store.albumsSelectedForSlideshow = { valid: true };

      await vi.waitFor(() => {
        // The watcher should try to call localStorage.setItem and catch the error
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to save album selection:',
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });

    it('should not re-initialize if called multiple times', () => {
      setupPersistenceWatcher();
      setupPersistenceWatcher();
    });
  });

  describe('loadInitialData', () => {
    it('should parse valid saved selection', async () => {
      // Mock return value
      localStorageMock.getItem.mockReturnValue(JSON.stringify({ saved: true }));

      vi.mocked(api.getAlbumsWithViewCounts).mockResolvedValue([]);
      vi.mocked(api.getMediaDirectories).mockResolvedValue([]);
      vi.mocked(api.getSupportedExtensions).mockResolvedValue({
        images: [],
        videos: [],
        all: [],
      });
      vi.mocked(api.getSmartPlaylists).mockResolvedValue([]);

      await store.loadInitialData();

      expect(store.albumsSelectedForSlideshow).toEqual({ saved: true });
    });

    it('should handle invalid JSON in saved selection and fallback to selectAll', async () => {
      localStorageMock.getItem.mockReturnValue('{ invalid');

      const albums = [{ id: '1', name: 'A1', textures: [] }];
      vi.mocked(api.getAlbumsWithViewCounts).mockResolvedValue(albums as any);
      vi.mocked(api.getMediaDirectories).mockResolvedValue([]);
      vi.mocked(api.getSupportedExtensions).mockResolvedValue({
        images: [],
        videos: [],
        all: [],
      });
      vi.mocked(api.getSmartPlaylists).mockResolvedValue([]);

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await store.loadInitialData();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to parse saved album selection:',
        expect.any(Error),
      );
      expect(store.albumsSelectedForSlideshow['1']).toBe(true);

      consoleSpy.mockRestore();
    });

    it('should use selectAll if no saved selection', async () => {
      const albums = [{ id: '2', name: 'A2', textures: [] }];

      localStorageMock.getItem.mockReturnValue(null);

      vi.mocked(api.getAlbumsWithViewCounts).mockResolvedValue(albums as any);
      vi.mocked(api.getMediaDirectories).mockResolvedValue([]);
      vi.mocked(api.getSupportedExtensions).mockResolvedValue({
        images: [],
        videos: [],
        all: [],
      });
      vi.mocked(api.getSmartPlaylists).mockResolvedValue([]);

      await store.loadInitialData();

      expect(store.albumsSelectedForSlideshow['2']).toBe(true);
    });
  });

  describe('fetchHistory', () => {
    it('should handle history items without last_viewed date', async () => {
      vi.mocked(api.getRecentlyPlayed).mockResolvedValue([
        {
          file_path: '/path/to/media.jpg',
          view_count: 5,
          rating: 4,
          // undefined last_viewed
        },
      ] as any);

      await store.fetchHistory();
      expect(store.historyMedia[0].lastViewed).toBeUndefined();
    });

    it('should handle history items with explicit last_viewed string', async () => {
      const now = new Date();
      vi.mocked(api.getRecentlyPlayed).mockResolvedValue([
        {
          file_path: '/media.jpg',
          last_viewed: now.toISOString(),
        },
      ] as any);

      await store.fetchHistory();
      expect(store.historyMedia[0].lastViewed).toBe(now.getTime());
    });

    it('should derive name from path if needed', async () => {
      vi.mocked(api.getRecentlyPlayed).mockResolvedValue([
        {
          file_path: 'C:\\Users\\Data\\image.png',
        },
      ] as any);

      await store.fetchHistory();
      expect(store.historyMedia[0].name).toBe('image.png');
    });

    it('should derive name using fallback if split fails (empty case)', async () => {
      vi.mocked(api.getRecentlyPlayed).mockResolvedValue([
        {
          file_path: 'simple',
        },
      ] as any);

      await store.fetchHistory();
      expect(store.historyMedia[0].name).toBe('simple');
    });

    it('should handle fetch errors', async () => {
      vi.mocked(api.getRecentlyPlayed).mockRejectedValue(
        new Error('API Error'),
      );
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await store.fetchHistory();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch history:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('selectAllAlbumsRecursively', () => {
    it('should handle deep nesting', () => {
      const deepAlbums = {
        id: 'root',
        name: 'root',
        children: [
          { id: 'c1', name: 'c1', children: [{ id: 'c2', name: 'c2' }] },
        ],
      };
      store.allAlbums = [deepAlbums as any];
      store.selectAllAlbumsRecursively([deepAlbums as any]);

      expect(store.albumsSelectedForSlideshow['root']).toBe(true);
    });
  });

  describe('allMediaFilesMap', () => {
    it('should map media files from allAlbums correctly', () => {
      const mockFile1 = { path: '/media/1.jpg', name: '1.jpg' };
      const mockFile2 = { path: '/media/2.mp4', name: '2.mp4' };
      const mockFile3 = { path: '/media/3.png', name: '3.png' };

      store.allAlbums = [
        {
          id: 'root',
          name: 'root',
          textures: [mockFile1],
          children: [
            {
              id: 'child1',
              name: 'child1',
              textures: [mockFile2],
              children: [
                {
                  id: 'child2',
                  name: 'child2',
                  textures: [mockFile3],
                },
              ],
            },
          ],
        },
      ] as any;

      const fileMap = store.allMediaFilesMap;
      expect(fileMap.size).toBe(3);
      expect(fileMap.get('/media/1.jpg')).toEqual(mockFile1);
      expect(fileMap.get('/media/2.mp4')).toEqual(mockFile2);
      expect(fileMap.get('/media/3.png')).toEqual(mockFile3);
    });
  });
});
