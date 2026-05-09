import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AlbumsList from '../../../src/renderer/components/AlbumsList.vue';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { api } from '../../../src/renderer/api';

vi.mock('../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    toggleAlbumSelection: vi.fn(),
    startSlideshow: vi.fn(),
    startIndividualAlbumSlideshow: vi.fn(),
    toggleSlideshowTimer: vi.fn(),
    openAlbumInGrid: vi.fn(),
  }),
}));
vi.mock('../../../src/renderer/api', () => ({
  api: {
    getAllMetadataAndStats: vi.fn(),
    executeSmartPlaylist: vi.fn(),
    deleteSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
  },
}));

describe('AlbumsList Coverage (Filtering)', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().smartPlaylists = [];
    useLibraryStore().historyMedia = [];
    useLibraryStore().mediaDirectories = [];

    usePlayerStore().timerDuration = 5;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().timerProgress = 0;
    usePlayerStore().isSlideshowActive = false;

    useUIStore().isSourcesModalVisible = false;
    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().gridMediaFiles = [];
    useUIStore().viewMode = 'player';
    useUIStore().playlistToEdit = null;

    (api.getSmartPlaylists as Mock).mockResolvedValue([]);
  });

  const mountList = () => mount(AlbumsList);

  it('filters by minDuration', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Long', criteria: JSON.stringify({ minDuration: 60 }) },
    ] as any;
    // Mock allAlbums to contain the files we are testing
    useLibraryStore().allAlbums = [
      {
        name: 'Root',
        children: [],
        textures: [
          { path: '/short.mp4', name: 'short.mp4' },
          { path: '/long.mp4', name: 'long.mp4' },
        ],
      },
    ] as any;

    // DB should return only matching items
    const items = [{ file_path: '/long.mp4', duration: 100 }];
    (api.executeSmartPlaylist as Mock).mockResolvedValue(items);

    const wrapper = mountList();
    await wrapper.vm.$nextTick();

    const playlistItem = wrapper
      .findAll('li')
      .find((li) => li.text().includes('Long'));
    const gridBtn = playlistItem!.find('button[title="Open in Grid"]');
    await gridBtn.trigger('click');

    // Wait for async operations
    await new Promise(process.nextTick);

    expect(useUIStore().gridMediaFiles).toHaveLength(1);
    expect(useUIStore().gridMediaFiles[0].path).toBe('/long.mp4');
  });

  it('filters by minViews', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Popular', criteria: JSON.stringify({ minViews: 5 }) },
    ] as any;
    useLibraryStore().allAlbums = [
      {
        name: 'Root',
        children: [],
        textures: [
          { path: '/rare.mp4', name: 'rare.mp4' },
          { path: '/popular.mp4', name: 'popular.mp4' },
        ],
      },
    ] as any;
    // DB returns only popular
    const items = [{ file_path: '/popular.mp4', view_count: 10 }];
    (api.executeSmartPlaylist as Mock).mockResolvedValue(items);

    const wrapper = mountList();
    await wrapper.vm.$nextTick();
    const playlistItem = wrapper
      .findAll('li')
      .find((li) => li.text().includes('Popular'));
    const gridBtn = playlistItem!.find('button[title="Open in Grid"]');
    await gridBtn.trigger('click');

    await new Promise(process.nextTick);

    expect(useUIStore().gridMediaFiles).toHaveLength(1);
    expect(useUIStore().gridMediaFiles[0].path).toBe('/popular.mp4');
  });

  it('filters by maxViews', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Unseen', criteria: JSON.stringify({ maxViews: 0 }) },
    ] as any;
    useLibraryStore().allAlbums = [
      {
        name: 'Root',
        children: [],
        textures: [
          { path: '/seen.mp4', name: 'seen.mp4' },
          { path: '/unseen.mp4', name: 'unseen.mp4' },
        ],
      },
    ] as any;
    // DB returns only unseen
    const items = [{ file_path: '/unseen.mp4', view_count: 0 }];
    (api.executeSmartPlaylist as Mock).mockResolvedValue(items);

    const wrapper = mountList();
    await wrapper.vm.$nextTick();
    const playlistItem = wrapper
      .findAll('li')
      .find((li) => li.text().includes('Unseen'));
    const gridBtn = playlistItem!.find('button[title="Open in Grid"]');
    await gridBtn.trigger('click');

    await new Promise(process.nextTick);

    expect(useUIStore().gridMediaFiles).toHaveLength(1);
    expect(useUIStore().gridMediaFiles[0].path).toBe('/unseen.mp4');
  });

  it('filters by minDaysSinceView', async () => {
    useLibraryStore().smartPlaylists = [
      {
        id: 1,
        name: 'Forgotten',
        criteria: JSON.stringify({ minDaysSinceView: 30 }),
      },
    ] as any;
    useLibraryStore().allAlbums = [
      {
        name: 'Root',
        children: [],
        textures: [
          { path: '/recent.mp4', name: 'recent.mp4' },
          { path: '/old.mp4', name: 'old.mp4' },
          { path: '/never.mp4', name: 'never.mp4' },
        ],
      },
    ] as any;
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    // DB returns only old and never
    const items = [
      {
        file_path: '/old.mp4',
        last_viewed: new Date(now - 100 * oneDay).toISOString(),
      }, // 100 days ago
      { file_path: '/never.mp4', last_viewed: null },
    ];
    (api.executeSmartPlaylist as Mock).mockResolvedValue(items);

    const wrapper = mountList();
    await wrapper.vm.$nextTick();
    const playlistItem = wrapper
      .findAll('li')
      .find((li) => li.text().includes('Forgotten'));
    const gridBtn = playlistItem!.find('button[title="Open in Grid"]');
    await gridBtn.trigger('click');

    await new Promise(process.nextTick);

    expect(useUIStore().gridMediaFiles.map((f: any) => f.path)).toEqual([
      '/old.mp4',
      '/never.mp4',
    ]);
  });

  it('handles error in filtering', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Broken', criteria: '{}' },
    ] as any;
    (api.executeSmartPlaylist as Mock).mockRejectedValue(new Error('API Fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mountList();
    await wrapper.vm.$nextTick();
    const playlistItem = wrapper
      .findAll('li')
      .find((li) => li.text().includes('Broken'));
    const gridBtn = playlistItem!.find('button[title="Open in Grid"]');
    await gridBtn.trigger('click');

    await new Promise(process.nextTick);

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error opening playlist grid',
      expect.any(Error),
    );
  });
});
