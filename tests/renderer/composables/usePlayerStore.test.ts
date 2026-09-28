import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { usePlayerStore } from '@/composables/usePlayerStore';

describe('usePlayerStore', () => {
  let store: ReturnType<typeof usePlayerStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    store = usePlayerStore();
  });

  it('should initialize with default values', () => {
    expect(store.isSlideshowActive).toBe(false);
  });

  it('should reset player state', () => {
    store.isSlideshowActive = true;
    store.resetPlayerState();
    expect(store.isSlideshowActive).toBe(false);
  });

  it('should stop slideshow and clear timer', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    // Simulate active timer
    store.slideshowTimerId = setTimeout(() => {}, 1000) as any;
    store.isTimerRunning = true;

    store.stopSlideshow();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    expect(store.slideshowTimerId).toBe(null);
    expect(store.isTimerRunning).toBe(false);

    vi.useRealTimers();
  });

  describe('haltPlayback', () => {
    it('pauses the video before stopping a timer suspended for it', () => {
      const store = usePlayerStore();
      const order: string[] = [];
      const video = {
        muted: false,
        pause: vi.fn(() => {
          // A pause event handler would see the timer still suspended here.
          order.push(`pause:${String(store.isTimerPausedForVideo)}`);
        }),
      };
      store.mainVideoElement = video as unknown as HTMLVideoElement;
      store.startSlideshowTimer(5000, () => {});
      store.suspendSlideshowTimerForVideo();

      store.haltPlayback();

      expect(order).toEqual(['pause:true']);
      expect(store.isTimerPausedForVideo).toBe(false);
      expect(store.isTimerRunning).toBe(false);
      expect(video.muted).toBe(false);
      expect(store.isMuted).toBe(false);
    });

    it('mutes when asked', () => {
      const store = usePlayerStore();
      const video = { muted: false, pause: vi.fn() };
      store.mainVideoElement = video as unknown as HTMLVideoElement;
      store.haltPlayback({ mute: true });
      expect(video.muted).toBe(true);
      expect(store.isMuted).toBe(true);
    });

    it('stops the timer without a video', () => {
      const store = usePlayerStore();
      store.startSlideshowTimer(5000, () => {});
      store.haltPlayback({ mute: true });
      expect(store.isTimerRunning).toBe(false);
      expect(store.isMuted).toBe(false);
    });
  });

  describe('slideshow settings persistence', () => {
    it('saves settings and restores them in a new session', async () => {
      const first = usePlayerStore();
      first.timerDuration = 12;
      first.pauseTimerOnPlay = true;
      first.videoAdvance = 'timer';
      first.randomStart = true;
      await nextTick();

      setActivePinia(createPinia());
      const second = usePlayerStore();
      expect(second.timerDuration).toBe(12);
      expect(second.pauseTimerOnPlay).toBe(true);
      expect(second.videoAdvance).toBe('timer');
      expect(second.randomStart).toBe(true);
    });

    it('falls back to defaults for invalid saved values', () => {
      localStorage.setItem(
        'slideshowSettings',
        JSON.stringify({
          timerDuration: 0,
          pauseTimerOnPlay: 'yes',
          videoAdvance: 'sometimes',
          randomStart: 1,
        }),
      );
      setActivePinia(createPinia());
      const fresh = usePlayerStore();
      expect(fresh.timerDuration).toBe(5);
      expect(fresh.pauseTimerOnPlay).toBe(false);
      expect(fresh.videoAdvance).toBe('end');
      expect(fresh.randomStart).toBe(false);
    });

    it.each(['{broken', 'null'])('ignores unreadable data %s', (raw) => {
      localStorage.setItem('slideshowSettings', raw);
      setActivePinia(createPinia());
      expect(usePlayerStore().timerDuration).toBe(5);
    });

    it('keeps working when saving fails', async () => {
      const setItem = vi
        .spyOn(localStorage, 'setItem')
        .mockImplementation(() => {
          throw new Error('quota');
        });
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      store.randomStart = true;
      await nextTick();
      expect(consoleSpy).toHaveBeenCalled();
      setItem.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
