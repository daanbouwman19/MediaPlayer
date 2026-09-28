import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia, createPinia } from 'pinia';
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
});
