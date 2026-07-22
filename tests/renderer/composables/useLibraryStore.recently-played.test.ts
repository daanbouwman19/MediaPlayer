import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { api } from '../../../src/renderer/api/index';
import { MediaLibraryItem } from '../../../src/core/media/types';

vi.mock('../../../src/renderer/api/index', () => ({
  api: {
    getAlbumsWithViewCounts: vi.fn(),
    getMediaDirectories: vi.fn(),
    getSmartPlaylists: vi.fn(),
    getSupportedExtensions: vi.fn(),
    getRecentlyPlayed: vi.fn(),
  },
}));

describe('useLibraryStore - Recently Played', () => {
  let store: ReturnType<typeof useLibraryStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    store = useLibraryStore();
    vi.clearAllMocks();
  });

  it('fetchHistory should fetch and populate historyMedia', async () => {
    const mockItems: MediaLibraryItem[] = [
      {
        file_path: '/path/to/video.mp4',
        file_path_hash: 'hash1',
        view_count: 5,
        last_viewed: '2023-01-01T12:00:00.000Z',
        rating: 4,
        duration: 100,
        size: 1000,
        created_at: '2022-01-01',
        watched_segments: null,
      },
      {
        file_path: '/path/to/image.jpg',
        file_path_hash: 'hash2',
        view_count: 1,
        last_viewed: '2023-01-02T12:00:00.000Z',
        rating: 0,
        duration: null,
        size: 500,
        created_at: '2022-01-01',
        watched_segments: null,
      },
    ];

    (api.getRecentlyPlayed as any).mockResolvedValue(mockItems);

    await store.fetchHistory(10);

    expect(api.getRecentlyPlayed).toHaveBeenCalledWith(10);
    expect(store.historyMedia).toHaveLength(2);
    // Unchanged order: the component passes through the DB order directly now
    expect(store.historyMedia[0].name).toBe('video.mp4');
    expect(store.historyMedia[0].viewCount).toBe(5);
    expect(store.historyMedia[0].rating).toBe(4);
    expect(store.historyMedia[0].lastViewed).toBe(
      new Date('2023-01-01T12:00:00.000Z').getTime(),
    );

    expect(store.historyMedia[1].name).toBe('image.jpg');
    expect(store.historyMedia[1].viewCount).toBe(1);
    expect(store.historyMedia[1].rating).toBe(0);
    expect(store.historyMedia[1].lastViewed).toBe(
      new Date('2023-01-02T12:00:00.000Z').getTime(),
    );
  });

  it('fetchHistory items expose only MediaFile fields and no allMediaFilesMap', async () => {
    const mockItems: MediaLibraryItem[] = [
      {
        file_path: '/media/clip.mp4',
        file_path_hash: 'hash-clip',
        view_count: 3,
        last_viewed: '2023-05-01T08:00:00.000Z',
        rating: 2,
        duration: 250,
        size: 2048,
        created_at: '2022-06-01',
        watched_segments: null,
        playback_position: 42,
      },
    ];

    (api.getRecentlyPlayed as any).mockResolvedValue(mockItems);

    await store.fetchHistory(5);

    expect(store.historyMedia).toHaveLength(1);
    const item = store.historyMedia[0];

    // Regression: the mapped history item must NOT leak the store's
    // allMediaFilesMap computed onto each MediaFile.
    expect(item).not.toHaveProperty('allMediaFilesMap');
    expect(Object.keys(item).sort()).toEqual(
      [
        'duration',
        'lastViewed',
        'name',
        'path',
        'playbackPosition',
        'rating',
        'viewCount',
      ].sort(),
    );

    // Expected fields are populated from the DB row.
    expect(item.name).toBe('clip.mp4');
    expect(item.path).toBe('/media/clip.mp4');
    expect(item.viewCount).toBe(3);
    expect(item.rating).toBe(2);
    expect(item.duration).toBe(250);
    expect(item.playbackPosition).toBe(42);
    expect(item.lastViewed).toBe(
      new Date('2023-05-01T08:00:00.000Z').getTime(),
    );
  });

  it('fetchHistory should handle API errors gracefully', async () => {
    (api.getRecentlyPlayed as any).mockRejectedValue(
      new Error('Network error'),
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await store.fetchHistory();

    expect(store.historyMedia).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
  });
});
