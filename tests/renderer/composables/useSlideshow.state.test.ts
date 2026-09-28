import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';
import { flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';
import type { Album, MediaFile } from '../../../src/core/media/types';

vi.mock('@/api', () => ({
  api: { recordMediaView: vi.fn() },
}));

const file = (path: string, extra: Partial<MediaFile> = {}): MediaFile => ({
  path,
  name: path,
  ...extra,
});

const album = (id: string, paths: string[]): Album => ({
  id,
  name: id,
  textures: paths.map((p) => file(p)),
  children: [],
});

/** Timer invariant: "running" exactly while a countdown is pending. */
const expectTimerRunning = (running: boolean) => {
  const player = usePlayerStore();
  expect(player.isTimerRunning).toBe(running);
  expect(player.slideshowTimerId !== null).toBe(running);
};

describe('useSlideshow timer and session state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Keep the 400 ms navigation debounce out of the way between steps.
    vi.setSystemTime(1_000_000);
    setActivePinia(
      createTestingPinia({ stubActions: false, createSpy: vi.fn }),
    );
    useLibraryStore().supportedExtensions = {
      videos: ['.mp4'],
      images: ['.jpg'],
      all: ['.mp4', '.jpg'],
    };
    usePlayerStore().timerDuration = 5;
    (api.recordMediaView as Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Lets the countdown elapse and the resulting navigation settle. */
  const elapse = async () => {
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
  };

  const startRunningAlbum = async (paths: string[]) => {
    const slideshow = useSlideshow();
    await slideshow.startIndividualAlbumSlideshow(album('A', paths));
    slideshow.toggleSlideshowTimer();
    expectTimerRunning(true);
    return slideshow;
  };

  describe('F06: view telemetry never stalls the slideshow', () => {
    it('keeps advancing when recording the view is rejected (HTTP 429)', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      (api.recordMediaView as Mock).mockRejectedValue(
        new Error('Too many requests'),
      );
      await startRunningAlbum(['1.jpg', '2.jpg', '3.jpg']);
      const playlist = usePlaylistStore();

      const seen = [playlist.currentItem?.path];
      for (let i = 0; i < 2; i++) {
        await elapse();
        seen.push(playlist.currentItem?.path);
        expectTimerRunning(true);
      }

      expect(new Set(seen).size).toBe(3);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error recording media view:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('arms the next countdown even while the view request is still pending', async () => {
      (api.recordMediaView as Mock).mockReturnValue(new Promise(() => {}));
      await startRunningAlbum(['1.jpg', '2.jpg']);
      const first = usePlaylistStore().currentItem?.path;

      await elapse();

      expect(usePlaylistStore().currentItem?.path).not.toBe(first);
      expectTimerRunning(true);
    });
  });

  describe('F49: history mode ends with the history session', () => {
    it.each([
      [
        'startSlideshow',
        async () => {
          useLibraryStore().allAlbums = [album('A', ['a.jpg'])];
          useLibraryStore().albumsSelectedForSlideshow = { A: true };
          await useSlideshow().startSlideshow();
        },
      ],
      [
        'startIndividualAlbumSlideshow',
        async () => {
          await useSlideshow().startIndividualAlbumSlideshow(
            album('A', ['a.jpg']),
          );
        },
      ],
    ])('%s records views after a Recently Played session', async (_, start) => {
      useSlideshow().startHistorySlideshow([file('h.jpg')]);
      expect(useUIStore().isHistoryMode).toBe(true);
      expect(api.recordMediaView).not.toHaveBeenCalled();

      await start();

      expect(useUIStore().isHistoryMode).toBe(false);
      expect(api.recordMediaView).toHaveBeenCalledWith('a.jpg');
    });

    it('openAlbumInGrid leaves history mode', () => {
      useSlideshow().startHistorySlideshow([file('h.jpg')]);
      useSlideshow().openAlbumInGrid(album('A', ['a.jpg']));
      expect(useUIStore().isHistoryMode).toBe(false);
    });
  });

  describe("F50: changing the filter keeps the session's pool", () => {
    it('keeps playing the album instead of every selected album', async () => {
      const library = useLibraryStore();
      library.allAlbums = [
        album('Holiday', ['h1.jpg', 'h2.mp4', 'h3.mp4']),
        album('Other', ['o1.mp4', 'o2.mp4', 'o3.mp4']),
      ];
      library.albumsSelectedForSlideshow = { Holiday: true, Other: true };
      const slideshow = useSlideshow();
      await slideshow.startIndividualAlbumSlideshow(library.allAlbums[0]!);

      useUIStore().mediaFilter = 'Videos';
      await slideshow.reapplyFilter();

      expect(usePlaylistStore().queue).toHaveLength(0);
      for (let i = 0; i < 6; i++) {
        vi.advanceTimersByTime(500);
        await slideshow.navigateMedia(1);
        expect(['h2.mp4', 'h3.mp4']).toContain(
          usePlaylistStore().currentItem?.path,
        );
      }
    });

    it('keeps replaying history, without recording views', async () => {
      const library = useLibraryStore();
      library.allAlbums = [album('Library', ['x.mp4', 'y.mp4'])];
      library.albumsSelectedForSlideshow = { Library: true };
      const slideshow = useSlideshow();
      slideshow.startHistorySlideshow([file('h1.mp4'), file('h2.jpg')]);

      useUIStore().mediaFilter = 'Videos';
      await slideshow.reapplyFilter();

      expect(usePlaylistStore().currentItem?.path).toBe('h1.mp4');
      expect(api.recordMediaView).not.toHaveBeenCalled();
    });
  });

  describe('F51: starting from history or the grid clears the pending countdown', () => {
    it('startHistorySlideshow stops a running countdown', async () => {
      const slideshow = await startRunningAlbum(['a.jpg', 'b.jpg']);

      slideshow.startHistorySlideshow([file('h1.jpg'), file('h2.jpg')]);
      expectTimerRunning(false);

      await elapse();
      expect(usePlaylistStore().currentItem?.path).toBe('h1.jpg');
    });

    it('playFromList (a grid click) stops a running countdown', async () => {
      const slideshow = await startRunningAlbum(['a.jpg', 'b.jpg']);

      await slideshow.playFromList([file('g1.mp4'), file('g2.mp4')], 0);
      expectTimerRunning(false);

      await elapse();
      expect(usePlaylistStore().currentItem?.path).toBe('g1.mp4');
    });

    it('openAlbumInGrid ends the slideshow and its countdown', async () => {
      const slideshow = await startRunningAlbum(['a.jpg', 'b.jpg']);
      const current = usePlaylistStore().currentItem?.path;

      slideshow.openAlbumInGrid(album('B', ['b1.jpg']));
      expectTimerRunning(false);
      expect(usePlayerStore().isSlideshowActive).toBe(false);

      await elapse();
      expect(usePlaylistStore().currentItem?.path).toBe(current);
      expect(api.recordMediaView).toHaveBeenCalledTimes(1);
    });
  });

  describe('F52: only a video pause resumes on its own', () => {
    it('stepping manually after a user pause does not restart the countdown', async () => {
      const slideshow = await startRunningAlbum(['a.jpg', 'b.jpg', 'c.jpg']);
      slideshow.toggleSlideshowTimer();
      expectTimerRunning(false);

      await slideshow.navigateMedia(1);
      slideshow.resumeSlideshowTimerAfterVideo();

      expectTimerRunning(false);
    });

    it('a countdown suspended for a long video resumes with the next item', async () => {
      const slideshow = await startRunningAlbum(['a.mp4', 'b.jpg']);
      slideshow.pauseSlideshowTimerForVideo();
      expectTimerRunning(false);
      expect(usePlayerStore().isTimerPausedForVideo).toBe(true);

      // The video ends: MediaDisplay advances.
      await slideshow.navigateMedia(1);

      expectTimerRunning(true);
      expect(usePlayerStore().isTimerPausedForVideo).toBe(false);
    });

    it('resumeSlideshowTimerAfterVideo resumes a video suspension only', async () => {
      const slideshow = await startRunningAlbum(['a.mp4', 'b.jpg']);
      slideshow.pauseSlideshowTimerForVideo();

      slideshow.resumeSlideshowTimerAfterVideo();
      expectTimerRunning(true);

      slideshow.pauseSlideshowTimer();
      slideshow.pauseSlideshowTimerForVideo(); // no-op: already stopped
      slideshow.resumeSlideshowTimerAfterVideo();
      expectTimerRunning(false);
    });
  });

  describe('F62: grid and queue playback go through the slideshow', () => {
    it('playFromList records the view and makes the list the pool', async () => {
      // An earlier, unrelated session.
      await useSlideshow().startIndividualAlbumSlideshow(
        album('Old', ['old.jpg']),
      );
      (api.recordMediaView as Mock).mockClear();

      const list = [file('a1.jpg'), file('a2.jpg'), file('a3.jpg')];
      const slideshow = useSlideshow();
      await slideshow.playFromList(list, 2);

      expect(api.recordMediaView).toHaveBeenCalledWith('a3.jpg');
      expect(usePlaylistStore().queue).toHaveLength(0);
      expect(useUIStore().viewMode).toBe('player');

      // The queue has run out: the next pick stays within album A.
      await slideshow.navigateMedia(1);
      expect(['a1.jpg', 'a2.jpg']).toContain(
        usePlaylistStore().currentItem?.path,
      );
    });

    it('playFromList ignores an index outside the list', async () => {
      await expect(
        useSlideshow().playFromList([file('a.jpg')], 3),
      ).resolves.toBe(false);
      expect(usePlayerStore().isSlideshowActive).toBe(false);
    });

    it('playQueuedItem records the view and keeps a running countdown going', async () => {
      const slideshow = await startRunningAlbum(['a.jpg', 'b.jpg', 'c.jpg']);
      const playlist = usePlaylistStore();
      const target = playlist.queue[1]!;
      (api.recordMediaView as Mock).mockClear();

      await slideshow.playQueuedItem(target);

      expect(playlist.currentItem?.path).toBe(target.path);
      expect(playlist.queue.map((f) => f.path)).not.toContain(target.path);
      expect(api.recordMediaView).toHaveBeenCalledWith(target.path);
      expectTimerRunning(true);

      await expect(slideshow.playQueuedItem(file('gone.jpg'))).resolves.toBe(
        false,
      );
    });
  });

  describe('F138: Previous without history', () => {
    it('keeps the running countdown', async () => {
      const slideshow = await startRunningAlbum(['a.jpg', 'b.jpg']);
      const first = usePlaylistStore().currentItem?.path;

      await slideshow.navigateMedia(-1);
      expectTimerRunning(true);

      await elapse();
      expect(usePlaylistStore().currentItem?.path).not.toBe(first);
    });
  });

  describe('F139: the random pick never repeats the item on screen', () => {
    it('skips the current item when history covers every other one', async () => {
      const library = useLibraryStore();
      const playlist = usePlaylistStore();
      const a = file('a.jpg');
      const b = file('b.jpg');
      library.globalMediaPoolForSelection = [a, b];
      usePlayerStore().isSlideshowActive = true;
      playlist.history = [b];
      playlist.currentItem = a;

      for (let i = 0; i < 20; i++) {
        playlist.history = [b];
        playlist.currentItem = a;
        await useSlideshow().pickAndDisplayNextMediaItem();
        expect(playlist.currentItem?.path).toBe('b.jpg');
      }
    });

    it('still plays a single-item pool', async () => {
      const playlist = usePlaylistStore();
      useLibraryStore().globalMediaPoolForSelection = [file('only.jpg')];
      playlist.currentItem = file('only.jpg');

      await expect(useSlideshow().pickAndDisplayNextMediaItem()).resolves.toBe(
        true,
      );
      expect(playlist.currentItem?.path).toBe('only.jpg');
    });
  });

  describe('F158: no phantom running timer', () => {
    it('startSlideshow reports that nothing could start and leaves the session alone', async () => {
      const slideshow = useSlideshow();
      useLibraryStore().allAlbums = [album('A', ['a.jpg'])];
      useLibraryStore().albumsSelectedForSlideshow = {};

      await expect(slideshow.startSlideshow()).resolves.toBe(false);
      expect(usePlayerStore().isSlideshowActive).toBe(false);

      // A selection with no media passing the filter does not start either.
      useLibraryStore().albumsSelectedForSlideshow = { A: true };
      useUIStore().mediaFilter = 'Videos';
      await expect(slideshow.startSlideshow()).resolves.toBe(false);
      await expect(
        slideshow.startIndividualAlbumSlideshow(album('A', ['a.jpg'])),
      ).resolves.toBe(false);
      expect(usePlayerStore().isSlideshowActive).toBe(false);
    });

    it('the countdown cannot run without an active slideshow', () => {
      useSlideshow().toggleSlideshowTimer();
      expectTimerRunning(false);
    });

    it('stops when the countdown elapses with nothing left to show', async () => {
      await startRunningAlbum(['a.jpg']);
      useLibraryStore().globalMediaPoolForSelection = [];

      await elapse();

      expectTimerRunning(false);
    });

    it('stops when the countdown elapses after the slideshow ended', async () => {
      await startRunningAlbum(['a.jpg', 'b.jpg']);
      usePlayerStore().isSlideshowActive = false;

      await elapse();

      expectTimerRunning(false);
    });

    it('stops when advancing throws', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      await startRunningAlbum(['a.jpg', 'b.jpg']);
      (usePlaylistStore().playNext as Mock).mockImplementation(() => {
        throw new Error('boom');
      });

      await elapse();

      expectTimerRunning(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Slideshow] Failed to advance to the next item:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });
});
