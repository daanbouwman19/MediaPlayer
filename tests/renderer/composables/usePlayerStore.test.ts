import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
