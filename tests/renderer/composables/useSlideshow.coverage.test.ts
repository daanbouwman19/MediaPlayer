import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { reactive, computed, toRefs } from 'vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/usePlaylistStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/api', () => ({
  api: { recordMediaView: vi.fn() },
}));

describe('useSlideshow Coverage Boost', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockPlaylistState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

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
      timerProgress: 0,
    });

    mockPlaylistState = reactive({
      history: [],
      queue: [],
      currentItem: null,
    });

    mockUIState = reactive({
      mediaFilter: 'All',
      isHistoryMode: false,
      viewMode: 'grid',
      gridMediaFiles: [],
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
    const playPrevious = vi.fn(() => {
      if (mockPlaylistState.history.length > 0) {
        mockPlaylistState.queue.unshift(mockPlaylistState.currentItem);
        mockPlaylistState.currentItem = mockPlaylistState.history.pop();
      }
    });
    const clearPlaylist = vi.fn(() => {
      mockPlaylistState.history = [];
      mockPlaylistState.queue = [];
      mockPlaylistState.currentItem = null;
    });
    const setQueue = vi.fn((q) => {
      mockPlaylistState.queue = q;
    });
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

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('filterMedia', () => {
    it('filters by All, Videos, Images and handles edge cases', () => {
      const { filterMedia } = useSlideshow();
      const files = [
        { path: 'v.mp4', name: 'v.mp4' },
        { path: 'i.jpg', name: 'i.jpg' },
        { path: 'unknown.txt', name: 'unknown.txt' },
        { path: null, name: null },
        null,
      ] as any;

      mockUIState.mediaFilter = 'All';
      expect(filterMedia(files).length).toBe(3);

      mockUIState.mediaFilter = 'Videos';
      expect(filterMedia(files).length).toBe(1);

      mockUIState.mediaFilter = 'Images';
      expect(filterMedia(files).length).toBe(1);

      expect(filterMedia([])).toEqual([]);
      expect(filterMedia(null as any)).toEqual([]);
    });
  });

  describe('displayMedia', () => {
    it('records view and manages timer', async () => {
      // Need to access displayMedia but it's internal to some other functions?
      // No, it's not exported. But pickAndDisplayNextMediaItem calls it.
      const { pickAndDisplayNextMediaItem } = useSlideshow();
      mockLibraryState.globalMediaPoolForSelection = [
        { path: 'v.mp4', name: 'v.mp4' },
      ];

      await pickAndDisplayNextMediaItem();
      expect(api.recordMediaView).toHaveBeenCalledWith('v.mp4');
      expect(mockPlaylistState.currentItem.viewCount).toBe(1);

      // In history mode, should not record view
      mockUIState.isHistoryMode = true;
      await pickAndDisplayNextMediaItem();
      expect(api.recordMediaView).toHaveBeenCalledTimes(1);
    });

    it('resumes timer for images or videos', async () => {
      const { pickAndDisplayNextMediaItem } = useSlideshow();
      mockPlayerState.isTimerRunning = true;

      // Image should resume timer
      mockLibraryState.globalMediaPoolForSelection = [
        { path: 'i.jpg', name: 'i.jpg' },
      ];
      await pickAndDisplayNextMediaItem();
      // check if interval was set
      expect(mockPlayerState.slideshowTimerId).not.toBeNull();

      // Video should resume timer (pausing happens at MediaDisplay level now)
      mockLibraryState.globalMediaPoolForSelection = [
        { path: 'v.mp4', name: 'v.mp4' },
      ];
      await pickAndDisplayNextMediaItem();
      expect(mockPlayerState.slideshowTimerId).not.toBeNull();
    });
  });

  describe('navigateMedia', () => {
    it('handles next and previous with history', async () => {
      const { navigateMedia } = useSlideshow();
      mockPlayerState.isSlideshowActive = true;

      // Mock Date.now to control the debounce time
      const dateSpy = vi.spyOn(Date, 'now');
      let now = 1000;
      dateSpy.mockImplementation(() => now);

      // No history, no next queue
      await navigateMedia(1); // Should call pickAndDisplayNextMediaItem

      // With next - advance time to pass the 400ms guard
      now = 1500;
      mockPlaylistState.queue = [{ path: 'next.jpg', name: 'next.jpg' }];
      await navigateMedia(1);
      expect(mockPlaylistState.currentItem.path).toBe('next.jpg');

      // With previous - advance time to pass the 400ms guard
      now = 2000;
      mockPlaylistState.history = [{ path: 'prev.jpg', name: 'prev.jpg' }];
      await navigateMedia(-1);
      expect(mockPlaylistState.currentItem.path).toBe('prev.jpg');

      dateSpy.mockRestore();

      // Slideshow not active
      mockPlayerState.isSlideshowActive = false;
      await navigateMedia(1);
      // nothing happens
    });
  });

  describe('timer logic', () => {
    it('counts down and navigates next', async () => {
      const {
        resumeSlideshowTimer,
        pauseSlideshowTimer,
        toggleSlideshowTimer,
      } = useSlideshow();
      mockPlayerState.timerDuration = 1; // 1 second
      mockPlayerState.isSlideshowActive = true;

      resumeSlideshowTimer();
      expect(mockPlayerState.isTimerRunning).toBe(true);
      expect(mockPlayerState.timerProgress).toBe(100);

      vi.advanceTimersByTime(500);
      expect(mockPlayerState.timerProgress).toBe(60);

      vi.advanceTimersByTime(501);
      expect(mockPlayerState.timerProgress).toBe(0);
      // Should have called navigateMedia(1) -> pickAndDisplay...

      pauseSlideshowTimer();
      expect(mockPlayerState.isTimerRunning).toBe(false);
      expect(mockPlayerState.slideshowTimerId).toBeNull();

      toggleSlideshowTimer(); // Should resume
      expect(mockPlayerState.isTimerRunning).toBe(true);
      toggleSlideshowTimer(); // Should pause
      expect(mockPlayerState.isTimerRunning).toBe(false);
    });
  });

  describe('toggleAlbumSelection', () => {
    it('toggles selection with and without explicit value', () => {
      const { toggleAlbumSelection } = useSlideshow();
      toggleAlbumSelection('a1');
      expect(mockLibraryState.albumsSelectedForSlideshow['a1']).toBe(true);
      toggleAlbumSelection('a1');
      expect(mockLibraryState.albumsSelectedForSlideshow['a1']).toBe(false);

      toggleAlbumSelection('a1', true);
      expect(mockLibraryState.albumsSelectedForSlideshow['a1']).toBe(true);
      toggleAlbumSelection('a1', true);
      expect(mockLibraryState.albumsSelectedForSlideshow['a1']).toBe(true);
    });
  });

  describe('startHistorySlideshow', () => {
    it('starts from history', () => {
      const { startHistorySlideshow } = useSlideshow();
      const history = [{ path: 'h1.jpg', name: 'h1.jpg' }];
      startHistorySlideshow(history);
      expect(mockPlayerState.isSlideshowActive).toBe(true);
      expect(mockUIState.isHistoryMode).toBe(true);
      expect(mockUIState.viewMode).toBe('player');
    });

    it('does nothing if empty history', () => {
      const { startHistorySlideshow } = useSlideshow();
      startHistorySlideshow([]);
      expect(mockPlayerState.isSlideshowActive).toBe(false);
    });
  });

  describe('openAlbumInGrid', () => {
    it('sets grid media files and switches view', () => {
      const { openAlbumInGrid } = useSlideshow();
      const album = {
        textures: [{ path: 't1.jpg', name: 't1.jpg' }],
        children: [],
      } as any;
      openAlbumInGrid(album);
      expect(mockUIState.viewMode).toBe('grid');
      expect(mockUIState.gridMediaFiles.length).toBe(1);
      expect(mockPlayerState.isSlideshowActive).toBe(false);
    });
  });

  describe('reapplyFilter', () => {
    it('rebuilds pool if slideshow is active', async () => {
      const { reapplyFilter } = useSlideshow();
      mockPlayerState.isSlideshowActive = true;
      mockLibraryState.allAlbums = [
        {
          id: 'a1',
          textures: [{ path: 't1.jpg', name: 't1.jpg' }],
          children: [],
        },
      ];
      mockLibraryState.albumsSelectedForSlideshow = { a1: true };

      await reapplyFilter();
      expect(mockLibraryState.globalMediaPoolForSelection.length).toBe(1);
    });
  });
});
