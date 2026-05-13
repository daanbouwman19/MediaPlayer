import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import TimerPanel from '../../../../src/renderer/components/AlbumsList/TimerPanel.vue';
import { usePlayerStore } from '../../../../src/renderer/composables/usePlayerStore';

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
    usePlayerStore().timerProgress = 50;
    usePlayerStore().isSlideshowActive = true;
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
    const wrapper = mount(TimerPanel);
    const playBtn = wrapper.find('[data-testid="timer-button"]');
    await playBtn.trigger('click');
    expect(mockStartSlideshow).toHaveBeenCalled();
    expect(mockToggleSlideshowTimer).toHaveBeenCalled();
  });

  it('calls startSlideshow on shuffle click', async () => {
    const wrapper = mount(TimerPanel);
    const shuffleBtn = wrapper.find('button[aria-label="Shuffle All Sources"]');
    await shuffleBtn.trigger('click');
    expect(mockStartSlideshow).toHaveBeenCalled();
  });
});
