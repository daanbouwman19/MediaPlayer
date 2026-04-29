import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { reactive, computed, toRefs } from 'vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { createMockElectronAPI } from '../mocks/electronAPI';

vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/usePlaylistStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/api', () => ({
  api: { recordMediaView: vi.fn() },
}));

global.window.electronAPI = createMockElectronAPI();

describe('useSlideshow', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockPlaylistState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLibraryState = reactive({
      globalMediaPoolForSelection: [],
      albumsSelectedForSlideshow: {},
      allAlbums: [],
      totalMediaInPool: 0,
      supportedExtensions: {
        videos: ['.mp4', '.webm'],
        images: ['.png', '.jpg', '.jpeg'],
      },
    });

    mockPlayerState = reactive({
      isSlideshowActive: false,
      slideshowTimerId: null,
      isTimerRunning: false,
      timerDuration: 30,
      playFullVideo: true,
    });

    mockPlaylistState = reactive({
      history: [],
      queue: [],
      currentItem: null,
    });

    mockUIState = reactive({
      mediaFilter: 'All',
      isHistoryMode: false,
    });

    const imageExtensionsSet = computed(
      () => new Set(mockLibraryState.supportedExtensions.images),
    );
    const videoExtensionsSet = computed(
      () => new Set(mockLibraryState.supportedExtensions.videos),
    );

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      clearMediaPool: vi.fn(),
      imageExtensionsSet,
      videoExtensionsSet,
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      stopSlideshow: vi.fn(),
    });

    const playNext = vi.fn((item) => {
      if (item) {
        if (mockPlaylistState.currentItem) {
          mockPlaylistState.history.push(mockPlaylistState.currentItem);
        }
        mockPlaylistState.currentItem = item;
      } else if (mockPlaylistState.queue.length > 0) {
        if (mockPlaylistState.currentItem) {
          mockPlaylistState.history.push(mockPlaylistState.currentItem);
        }
        mockPlaylistState.currentItem = mockPlaylistState.queue.shift();
      }
    });
    const playPrevious = vi.fn();
    const clearPlaylist = vi.fn(() => {
      mockPlaylistState.history = [];
      mockPlaylistState.queue = [];
      mockPlaylistState.currentItem = null;
    });
    const setQueue = vi.fn();
    const hasPrevious = computed(() => mockPlaylistState.history.length > 0);
    const hasNext = computed(() => mockPlaylistState.queue.length > 0);

    const playlistStateRefs = toRefs(mockPlaylistState);
    (usePlaylistStore as Mock).mockReturnValue({
      state: mockPlaylistState,
      currentItem: playlistStateRefs.currentItem,
      playNext,
      playPrevious,
      clearPlaylist,
      setQueue,
      hasPrevious,
      hasNext,
    });

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
    });
  });

  describe('startSlideshow', () => {
    it('should build a media pool from selected albums including children', async () => {
      mockLibraryState.allAlbums = [
        {
          id: 'albumA',
          name: 'albumA',
          textures: [{ path: 'a1.png', name: 'a1.png' }],
          children: [],
        },
      ];
      mockLibraryState.albumsSelectedForSlideshow = { albumA: true };
      const { startSlideshow } = useSlideshow();
      await startSlideshow();
      expect(mockLibraryState.globalMediaPoolForSelection.length).toBe(1);
      expect(mockPlayerState.isSlideshowActive).toBe(true);
    });
  });

  describe('startIndividualAlbumSlideshow', () => {
    it('should do nothing if the album has no textures', async () => {
      const album = { name: 'emptyAlbum', textures: [] };
      const { startIndividualAlbumSlideshow } = useSlideshow();
      await startIndividualAlbumSlideshow(album as any);
      expect(mockPlayerState.isSlideshowActive).toBe(false);
    });

    it('should start slideshow for a single album', async () => {
      const album = {
        name: 'albumA',
        textures: [{ path: 'a1.png', name: 'a1.png' }],
      };
      const { startIndividualAlbumSlideshow } = useSlideshow();
      await startIndividualAlbumSlideshow(album as any);
      expect(mockPlayerState.isSlideshowActive).toBe(true);
      expect(mockPlaylistState.currentItem.path).toBe('a1.png');
    });
  });

  describe('displayMedia', () => {
    it('should resume slideshow timer for any media when timer is running', async () => {
      mockPlayerState.isTimerRunning = true;
      mockPlayerState.timerDuration = 5;

      const { pickAndDisplayNextMediaItem } = useSlideshow();

      mockLibraryState.globalMediaPoolForSelection = [
        { path: 'a1.mp4', name: 'a1.mp4' },
      ];

      await pickAndDisplayNextMediaItem();

      expect(mockPlayerState.isTimerRunning).toBe(true);
      expect(mockPlayerState.slideshowTimerId).not.toBeNull();
    });
  });
});
