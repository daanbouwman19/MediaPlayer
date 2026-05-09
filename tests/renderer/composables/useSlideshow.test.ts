import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { createMockElectronAPI } from '../mocks/electronAPI';

vi.mock('@/api', () => ({
  api: { recordMediaView: vi.fn() },
}));

global.window.electronAPI = createMockElectronAPI();

describe('useSlideshow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createTestingPinia({ stubActions: false, createSpy: vi.fn }));
    useLibraryStore().supportedExtensions = {
      videos: ['.mp4', '.webm'],
      images: ['.png', '.jpg', '.jpeg'],
      all: [],
    };
  });

  describe('startSlideshow', () => {
    it('should build a media pool from selected albums including children', async () => {
      const libraryStore = useLibraryStore();
      const playerStore = usePlayerStore();

      libraryStore.allAlbums = [
        {
          id: 'albumA',
          name: 'albumA',
          textures: [{ path: 'a1.png', name: 'a1.png' }],
          children: [],
        },
      ] as any;
      libraryStore.albumsSelectedForSlideshow = { albumA: true };

      const { startSlideshow } = useSlideshow();
      await startSlideshow();

      expect(libraryStore.globalMediaPoolForSelection.length).toBe(1);
      expect(playerStore.isSlideshowActive).toBe(true);
    });
  });

  describe('startIndividualAlbumSlideshow', () => {
    it('should do nothing if the album has no textures', async () => {
      const album = { name: 'emptyAlbum', textures: [] };
      const { startIndividualAlbumSlideshow } = useSlideshow();
      await startIndividualAlbumSlideshow(album as any);
      expect(usePlayerStore().isSlideshowActive).toBe(false);
    });

    it('should start slideshow for a single album', async () => {
      const album = {
        name: 'albumA',
        textures: [{ path: 'a1.png', name: 'a1.png' }],
      };
      const { startIndividualAlbumSlideshow } = useSlideshow();
      await startIndividualAlbumSlideshow(album as any);
      expect(usePlayerStore().isSlideshowActive).toBe(true);
      expect(usePlaylistStore().currentItem?.path).toBe('a1.png');
    });
  });

  describe('displayMedia', () => {
    it('should resume slideshow timer for any media when timer is running', async () => {
      const playerStore = usePlayerStore();
      const libraryStore = useLibraryStore();
      playerStore.isTimerRunning = true;
      playerStore.timerDuration = 5;

      const { pickAndDisplayNextMediaItem } = useSlideshow();

      libraryStore.globalMediaPoolForSelection = [
        { path: 'a1.mp4', name: 'a1.mp4' },
      ] as any;

      await pickAndDisplayNextMediaItem();

      expect(playerStore.isTimerRunning).toBe(true);
      expect(playerStore.slideshowTimerId).not.toBeNull();
    });
  });
});
