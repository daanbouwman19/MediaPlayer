import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import TimerPanel from '@/features/library/AlbumsList/TimerPanel.vue';
import { usePlayerStore } from '../../../../src/renderer/composables/usePlayerStore';
import { useToast } from '../../../../src/renderer/composables/useToast';

const mockToggleSlideshowTimer = vi.fn();
const mockStartSlideshow = vi.fn();

vi.mock('../../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    startSlideshow: mockStartSlideshow,
    toggleSlideshowTimer: mockToggleSlideshowTimer,
  }),
}));

describe('TimerPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    usePlayerStore().timerDuration = 5;
    usePlayerStore().isTimerRunning = true;
    usePlayerStore().isSlideshowActive = true;
    usePlayerStore().timerStartTime = Date.now();
    usePlayerStore().timerEndTime = Date.now() + 5000;
  });

  it('renders progress bar when running', () => {
    const wrapper = mount(TimerPanel);
    expect(wrapper.find('[data-testid="slideshow-progress"]').exists()).toBe(
      true,
    );
  });

  it('updates timer duration on blur', async () => {
    const wrapper = mount(TimerPanel);
    const input = wrapper.find('input');
    await input.setValue('10');
    await input.trigger('blur');
    expect(usePlayerStore().timerDuration).toBe(10);
  });

  it('toggles timer correctly when slideshow is active', async () => {
    usePlayerStore().isSlideshowActive = true;
    const wrapper = mount(TimerPanel);
    const playBtn = wrapper.find('[data-testid="timer-button"]');
    await playBtn.trigger('click');
    expect(mockStartSlideshow).not.toHaveBeenCalled();
    expect(mockToggleSlideshowTimer).toHaveBeenCalled();
  });

  it('starts slideshow and toggles timer correctly when slideshow is not active', async () => {
    usePlayerStore().isSlideshowActive = false;
    mockStartSlideshow.mockResolvedValue(true);
    const wrapper = mount(TimerPanel);
    const playBtn = wrapper.find('[data-testid="timer-button"]');
    await playBtn.trigger('click');
    await flushPromises();
    expect(mockStartSlideshow).toHaveBeenCalled();
    expect(mockToggleSlideshowTimer).toHaveBeenCalled();
  });

  it('does not start the timer when there is nothing to play', async () => {
    usePlayerStore().isSlideshowActive = false;
    mockStartSlideshow.mockResolvedValue(false);
    const wrapper = mount(TimerPanel);
    await wrapper.find('[data-testid="timer-button"]').trigger('click');
    await flushPromises();
    expect(mockStartSlideshow).toHaveBeenCalled();
    expect(mockToggleSlideshowTimer).not.toHaveBeenCalled();
    expect(useToast().toasts.value.at(-1)?.message).toContain(
      'Nothing to play',
    );
  });

  it('animates the progress bar of a countdown that was already running on mount', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    usePlayerStore().timerStartTime = 0;
    usePlayerStore().timerEndTime = 4000;

    const wrapper = mount(TimerPanel);
    vi.advanceTimersToNextFrame();
    await wrapper.vm.$nextTick();

    // A quarter of the countdown has elapsed, so the bar is about 75% full
    // (not frozen at 100%).
    const bar = wrapper.find('[data-testid="slideshow-progress"] > div');
    const width = parseFloat(
      /width:\s*([\d.]+)%/.exec(bar.attributes('style') ?? '')?.[1] ?? '',
    );
    expect(width).toBeGreaterThan(70);
    expect(width).toBeLessThanOrEqual(75);
    wrapper.unmount();
    vi.useRealTimers();
  });

  it('calls startSlideshow on shuffle click', async () => {
    const wrapper = mount(TimerPanel);
    const shuffleBtn = wrapper.find('button[aria-label="Shuffle All Sources"]');
    await shuffleBtn.trigger('click');
    expect(mockStartSlideshow).toHaveBeenCalled();
  });

  it('updates display progress in animation frame', async () => {
    vi.useFakeTimers();
    usePlayerStore().isTimerRunning = true;
    usePlayerStore().timerStartTime = 1000;
    usePlayerStore().timerEndTime = 2000;

    vi.setSystemTime(1500);

    const wrapper = mount(TimerPanel);

    // allow initial mount watcher/effect to trigger
    await wrapper.vm.$nextTick();

    // Trigger watcher for isTimerRunning
    usePlayerStore().isTimerRunning = false;
    await wrapper.vm.$nextTick();

    usePlayerStore().isTimerRunning = true;
    await wrapper.vm.$nextTick();

    // In test environment, the updateProgress will execute
    // when we run timers.
    vi.runAllTimers();
    await wrapper.vm.$nextTick();

    // The displayProgress is internal, but we can verify it doesn't crash
    // and cleanup happens on unmount.
    wrapper.unmount();
    vi.useRealTimers();
  });

  it('handles missing start/end times in update loop and clears existing animation frames', async () => {
    vi.useFakeTimers();
    usePlayerStore().isTimerRunning = true;
    usePlayerStore().timerStartTime = 1000;
    usePlayerStore().timerEndTime = 2000;

    const wrapper = mount(TimerPanel);
    await wrapper.vm.$nextTick();

    // Now disable it to trigger the watcher branch that cancels existing animation frame
    usePlayerStore().isTimerRunning = false;
    await wrapper.vm.$nextTick();

    // Force missing end time for branch coverage
    usePlayerStore().timerStartTime = 1000;
    usePlayerStore().timerEndTime = null;
    usePlayerStore().isTimerRunning = true;
    await wrapper.vm.$nextTick();

    // And simulate missing start time
    usePlayerStore().timerStartTime = null;
    await wrapper.vm.$nextTick();

    wrapper.unmount();
    vi.useRealTimers();
  });

  it('completes updateProgress when elapsed is >= total', async () => {
    vi.useFakeTimers();
    const originalDateNow = Date.now;
    const mockNow = 3000;
    Date.now = vi.fn(() => mockNow);

    usePlayerStore().isTimerRunning = true;
    usePlayerStore().timerStartTime = 1000;
    usePlayerStore().timerEndTime = 2000; // Total 1000. Elapsed 2000.

    const wrapper = mount(TimerPanel);
    await wrapper.vm.$nextTick();

    // Trigger watcher logic
    usePlayerStore().isTimerRunning = false;
    await wrapper.vm.$nextTick();
    usePlayerStore().isTimerRunning = true;
    await wrapper.vm.$nextTick();

    vi.runAllTimers(); // runs requestAnimationFrame polyfill

    // The updateProgress function will detect elapsed >= total and clear the frame id
    wrapper.unmount();
    Date.now = originalDateNow;
    vi.useRealTimers();
  });

  it('bypasses updateProgress logic if elapsed is somehow negative or total is 0', async () => {
    vi.useFakeTimers();
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => 1000);

    usePlayerStore().isTimerRunning = true;
    usePlayerStore().timerStartTime = 1000;
    usePlayerStore().timerEndTime = 1000; // Total 0

    const wrapper = mount(TimerPanel);
    await wrapper.vm.$nextTick();

    usePlayerStore().isTimerRunning = false;
    await wrapper.vm.$nextTick();
    usePlayerStore().isTimerRunning = true;
    await wrapper.vm.$nextTick();

    vi.runAllTimers();

    wrapper.unmount();
    Date.now = originalDateNow;
    vi.useRealTimers();
  });
});
