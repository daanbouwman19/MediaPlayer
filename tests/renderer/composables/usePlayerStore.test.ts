import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlayerStore } from '@/composables/usePlayerStore';

describe('usePlayerStore', () => {
  let store: ReturnType<typeof usePlayerStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = usePlayerStore();
    store.resetPlayerState();
    store.stopSlideshow();
  });

  it('should initialize with default values', () => {
    expect(store.isSlideshowActive.value).toBe(false);
  });

  it('should reset player state', () => {
    store.isSlideshowActive.value = true;
    store.resetPlayerState();
    expect(store.isSlideshowActive.value).toBe(false);
  });

  it('should stop slideshow and clear timer', () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    // Simulate active timer
    store.slideshowTimerId.value = setInterval(() => {}, 1000) as any;
    store.isTimerRunning.value = true;

    store.stopSlideshow();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(store.slideshowTimerId.value).toBe(null);
    expect(store.isTimerRunning.value).toBe(false);

    vi.useRealTimers();
  });
});
