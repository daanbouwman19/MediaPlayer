import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: { recordMediaView: vi.fn() },
}));

describe('useSlideshow Coverage Boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setActivePinia(createTestingPinia({ stubActions: false, createSpy: vi.fn }));
    useLibraryStore().supportedExtensions = {
      videos: ['.mp4', '.webm'],
      images: ['.png', '.jpg', '.jpeg'],
      all: [],
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('filterMedia', () => {
    it('filters by All, Videos, Images and handles edge cases', () => {
      const uiStore = useUIStore();
      const { filterMedia } = useSlideshow();
      const files = [
        { path: 'v.mp4', name: 'v.mp4' },
        { path: 'i.jpg', name: 'i.jpg' },
        { path: 'unknown.txt', name: 'unknown.txt' },
        { path: null, name: null },
        null,
      ] as any;

      uiStore.mediaFilter = 'All';
      expect(filterMedia(files).length).toBe(3);

      uiStore.mediaFilter = 'Videos';
      expect(filterMedia(files).length).toBe(1);

      uiStore.mediaFilter = 'Images';
      expect(filterMedia(files).length).toBe(1);

      expect(filterMedia([])).toEqual([]);
      expect(filterMedia(null as any)).toEqual([]);
    });
  });

  describe('displayMedia', () => {
    it('records view and manages timer', async () => {
      const libraryStore = useLibraryStore();
      const playlistStore = usePlaylistStore();
      const uiStore = useUIStore();

      const { pickAndDisplayNextMediaItem } = useSlideshow();
      libraryStore.globalMediaPoolForSelection = [
        { path: 'v.mp4', name: 'v.mp4' },
      ] as any;

      await pickAndDisplayNextMediaItem();
      expect(api.recordMediaView).toHaveBeenCalledWith('v.mp4');
      expect(playlistStore.currentItem?.viewCount).toBe(1);

      uiStore.isHistoryMode = true;
      await pickAndDisplayNextMediaItem();
      expect(api.recordMediaView).toHaveBeenCalledTimes(1);
    });

    it('resumes timer for images or videos', async () => {
      const libraryStore = useLibraryStore();
      const playerStore = usePlayerStore();

      const { pickAndDisplayNextMediaItem } = useSlideshow();
      playerStore.isTimerRunning = true;

      libraryStore.globalMediaPoolForSelection = [
        { path: 'i.jpg', name: 'i.jpg' },
      ] as any;
      await pickAndDisplayNextMediaItem();
      expect(playerStore.slideshowTimerId).not.toBeNull();

      libraryStore.globalMediaPoolForSelection = [
        { path: 'v.mp4', name: 'v.mp4' },
      ] as any;
      await pickAndDisplayNextMediaItem();
      expect(playerStore.slideshowTimerId).not.toBeNull();
    });
  });

  describe('navigateMedia', () => {
    it('handles next and previous with history', async () => {
      const playerStore = usePlayerStore();
      const playlistStore = usePlaylistStore();

      const { navigateMedia } = useSlideshow();
      playerStore.isSlideshowActive = true;

      const dateSpy = vi.spyOn(Date, 'now');
      let now = 1000;
      dateSpy.mockImplementation(() => now);

      await navigateMedia(1);

      now = 1500;
      playlistStore.queue = [{ path: 'next.jpg', name: 'next.jpg' }] as any;
      await navigateMedia(1);
      expect(playlistStore.currentItem?.path).toBe('next.jpg');

      now = 2000;
      playlistStore.history = [{ path: 'prev.jpg', name: 'prev.jpg' }] as any;
      await navigateMedia(-1);
      expect(playlistStore.currentItem?.path).toBe('prev.jpg');

      dateSpy.mockRestore();

      playerStore.isSlideshowActive = false;
      await navigateMedia(1);
    });
  });

  describe('timer logic', () => {
    it('counts down and navigates next', async () => {
      const playerStore = usePlayerStore();

      const {
        resumeSlideshowTimer,
        pauseSlideshowTimer,
        toggleSlideshowTimer,
      } = useSlideshow();
      playerStore.timerDuration = 1;
      playerStore.isSlideshowActive = true;

      resumeSlideshowTimer();
      expect(playerStore.isTimerRunning).toBe(true);
      expect(playerStore.timerProgress).toBe(100);

      vi.advanceTimersByTime(500);
      expect(playerStore.timerProgress).toBe(60);

      vi.advanceTimersByTime(501);
      expect(playerStore.timerProgress).toBe(0);

      pauseSlideshowTimer();
      expect(playerStore.isTimerRunning).toBe(false);
      expect(playerStore.slideshowTimerId).toBeNull();

      toggleSlideshowTimer();
      expect(playerStore.isTimerRunning).toBe(true);
      toggleSlideshowTimer();
      expect(playerStore.isTimerRunning).toBe(false);
    });
  });

  describe('toggleAlbumSelection', () => {
    it('toggles selection with and without explicit value', () => {
      const libraryStore = useLibraryStore();
      const { toggleAlbumSelection } = useSlideshow();

      toggleAlbumSelection('a1');
      expect(libraryStore.albumsSelectedForSlideshow['a1']).toBe(true);
      toggleAlbumSelection('a1');
      expect(libraryStore.albumsSelectedForSlideshow['a1']).toBe(false);

      toggleAlbumSelection('a1', true);
      expect(libraryStore.albumsSelectedForSlideshow['a1']).toBe(true);
      toggleAlbumSelection('a1', true);
      expect(libraryStore.albumsSelectedForSlideshow['a1']).toBe(true);
    });
  });

  describe('startHistorySlideshow', () => {
    it('starts from history', () => {
      const playerStore = usePlayerStore();
      const uiStore = useUIStore();

      const { startHistorySlideshow } = useSlideshow();
      const history = [{ path: 'h1.jpg', name: 'h1.jpg' }];
      startHistorySlideshow(history);
      expect(playerStore.isSlideshowActive).toBe(true);
      expect(uiStore.isHistoryMode).toBe(true);
      expect(uiStore.viewMode).toBe('player');
    });

    it('does nothing if empty history', () => {
      const { startHistorySlideshow } = useSlideshow();
      startHistorySlideshow([]);
      expect(usePlayerStore().isSlideshowActive).toBe(false);
    });
  });

  describe('openAlbumInGrid', () => {
    it('sets grid media files and switches view', () => {
      const uiStore = useUIStore();
      const playerStore = usePlayerStore();

      const { openAlbumInGrid } = useSlideshow();
      const album = {
        textures: [{ path: 't1.jpg', name: 't1.jpg' }],
        children: [],
      } as any;
      openAlbumInGrid(album);
      expect(uiStore.viewMode).toBe('grid');
      expect(uiStore.gridMediaFiles.length).toBe(1);
      expect(playerStore.isSlideshowActive).toBe(false);
    });
  });

  describe('reapplyFilter', () => {
    it('rebuilds pool if slideshow is active', async () => {
      const playerStore = usePlayerStore();
      const libraryStore = useLibraryStore();

      const { reapplyFilter } = useSlideshow();
      playerStore.isSlideshowActive = true;
      libraryStore.allAlbums = [
        {
          id: 'a1',
          textures: [{ path: 't1.jpg', name: 't1.jpg' }],
          children: [],
        },
      ] as any;
      libraryStore.albumsSelectedForSlideshow = { a1: true };

      await reapplyFilter();
      expect(libraryStore.globalMediaPoolForSelection.length).toBe(1);
    });
  });
});
