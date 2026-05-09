import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaControls from '@/components/MediaControls.vue';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    getHeatmapProgress: vi.fn(),
    getHeatmap: vi.fn(),
    getMetadata: vi.fn(),
  },
}));

// Mock ResizeObserver
const disconnectMock = vi.fn();
const observeMock = vi.fn();

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    constructor(callback: any) {
      callback([{ contentRect: { width: 1000 } }]);
    }
    observe = observeMock;
    disconnect = disconnectMock;
    unobserve = vi.fn();
  };
});

afterAll(() => {
  delete (global as any).ResizeObserver;
});

// Mock Icons
vi.mock('@/components/icons/VlcIcon.vue', () => ({
  default: { template: '<svg class="vlc-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/StarIcon.vue', () => ({
  default: { template: '<svg class="star-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/ChevronLeftIcon.vue', () => ({
  default: { template: '<svg class="chevron-left-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/ChevronRightIcon.vue', () => ({
  default: { template: '<svg class="chevron-right-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/VRIcon.vue', () => ({
  default: { template: '<svg class="vr-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/PlayIcon.vue', () => ({
  default: { template: '<svg class="play-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/PauseIcon.vue', () => ({
  default: { template: '<svg class="pause-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/ExpandIcon.vue', () => ({
  default: { template: '<svg class="expand-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/VolumeUpIcon.vue', () => ({
  default: { template: '<svg class="volume-up-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/VolumeOffIcon.vue', () => ({
  default: { template: '<svg class="volume-off-icon-mock"></svg>' },
}));
vi.mock('@/components/icons/SpinnerIcon.vue', () => ({
  default: { template: '<svg class="spinner-icon-mock"></svg>' },
}));

vi.mock('@/components/ProgressBar.vue', () => ({
  default: {
    template:
      '<div class="progress-bar-mock" @click="$emit(\'seek\', 10)"></div>',
    props: ['currentTime', 'duration', 'heatmap', 'watchedSegments'],
  },
}));

describe('MediaControls.vue', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useUIStore().isSidebarVisible = false;
  });

  // Mock getBoundingClientRect
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 1000 }),
    });
  });

  const defaultProps = {
    currentMediaItem: { name: 'test.jpg', path: '/test.jpg', rating: 3 },
    isPlaying: false,
    canNavigate: true,
    isControlsVisible: true,
    isImage: true,
    countInfo: '1 / 10',
  };

  it('should emit previous when back button clicked', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    await wrapper
      .find('button[aria-label="Previous media (Z)"]')
      .trigger('click');
    expect(wrapper.emitted('previous')).toBeTruthy();
  });

  it('should emit next when forward button clicked', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    await wrapper.find('button[aria-label="Next media (X)"]').trigger('click');
    expect(wrapper.emitted('next')).toBeTruthy();
  });

  it('should emit toggle-play when play button clicked', async () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
    });
    await wrapper.find('.play-pause-button').trigger('click');
    expect(wrapper.emitted('toggle-play')).toBeTruthy();
  });

  it('should emit open-in-vlc when VLC button clicked', async () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
    });
    await wrapper.find('.vlc-button').trigger('click');
    expect(wrapper.emitted('open-in-vlc')).toBeTruthy();
  });

  it('should emit set-rating when star clicked', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    await wrapper.vm.$nextTick();

    const stars = wrapper
      .findAll('button')
      .filter((b) => b.attributes('aria-label')?.includes('Rate'));

    expect(stars.length, 'Rating stars should be rendered').toBeGreaterThan(0);

    await stars[1].trigger('click'); // Rate 2 stars
    expect(wrapper.emitted('set-rating')).toBeTruthy();
    expect(wrapper.emitted('set-rating')?.[0]).toEqual([2]);
  });

  it('should disable navigation if canNavigate is false', () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, canNavigate: false },
    });
    const buttons = wrapper.findAll('button');
    const prev = buttons.find(
      (b) => b.attributes('aria-label') === 'No previous media',
    );
    const next = buttons.find(
      (b) => b.attributes('aria-label') === 'Next media (X)',
    );
    expect(prev?.attributes('disabled')).toBeDefined();
    expect(next?.attributes('disabled')).toBeDefined();
  });

  it('should disable previous button when canGoPrevious is false', () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, canNavigate: true, canGoPrevious: false },
    });
    const prevButton = wrapper.find('button[title="No previous media"]');
    expect(prevButton.exists()).toBe(true);
    expect(prevButton.attributes('disabled')).toBeDefined();
    expect(prevButton.attributes('aria-label')).toBe('No previous media');

    const nextButton = wrapper.find('button[title="Next media (X)"]');
    expect(nextButton.attributes('disabled')).toBeUndefined();
  });

  it('should emit toggle-fullscreen when fullscreen button clicked', async () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
    });
    await wrapper
      .find('button[aria-label="Toggle Fullscreen"]')
      .trigger('click');
    expect(wrapper.emitted('toggle-fullscreen')).toBeTruthy();
  });

  it('should have tooltips on navigation buttons', () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    const prevBtn = wrapper.find('button[aria-label="Previous media (Z)"]');
    const nextBtn = wrapper.find('button[aria-label="Next media (X)"]');
    expect(prevBtn.attributes('title')).toBe('Previous media (Z)');
    expect(nextBtn.attributes('title')).toBe('Next media (X)');
  });

  it('should have tooltips on play/pause button', async () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
    });

    const playBtn = wrapper.find('button[aria-label="Play video (Space)"]');
    expect(playBtn.attributes('title')).toBe('Play video (Space)');

    await wrapper.setProps({ isPlaying: true });
    const pauseBtn = wrapper.find('button[aria-label="Pause video (Space)"]');
    expect(pauseBtn.attributes('title')).toBe('Pause video (Space)');
  });

  it('should have tooltips on rating stars', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    await wrapper.vm.$nextTick();

    const stars = wrapper.findAll('button[aria-label^="Rate"]');
    if (stars.length > 0) {
      expect(stars[0].attributes('title')).toBe('Rate 1 star');
      expect(stars[1].attributes('title')).toBe('Rate 2 stars');
      expect(stars[4].attributes('title')).toBe('Rate 5 stars');
    }
  });

  it('should have accessible attributes on heatmap loading indicator', async () => {
    vi.useFakeTimers();

    vi.mocked(api.getHeatmap).mockImplementation(() => new Promise(() => {}));

    const wrapper = mount(MediaControls, { props: defaultProps });

    await vi.advanceTimersByTimeAsync(1100);
    await wrapper.vm.$nextTick();

    const indicator = wrapper.find('[role="status"]');
    expect(indicator.exists()).toBe(true);
    expect(indicator.attributes('aria-live')).toBe('polite');
    expect(indicator.attributes('aria-atomic')).toBe('true');
    expect(indicator.text()).toContain('Analyzing Scene...');

    vi.useRealTimers();
  });

  it('fetches heatmap and metadata after debounce', async () => {
    vi.useFakeTimers();
    vi.mocked(api.getHeatmap).mockResolvedValue({
      audio: [0.5],
      motion: [0.5],
      points: 1,
    } as any);
    vi.mocked(api.getMetadata).mockResolvedValue({
      '/test.jpg': {
        watchedSegments: JSON.stringify([{ start: 0, end: 10 }]),
      } as any,
    });
    vi.mocked(api.getHeatmapProgress).mockResolvedValue(50);

    const wrapper = mount(MediaControls, { props: defaultProps });

    await vi.advanceTimersByTimeAsync(1100);

    expect(api.getHeatmap).toHaveBeenCalledWith('/test.jpg', 100);
    expect(api.getMetadata).toHaveBeenCalledWith(['/test.jpg']);

    await vi.advanceTimersByTimeAsync(2100);

    expect((wrapper.vm as any).watchedSegments).toEqual([
      { start: 0, end: 10 },
    ]);

    vi.useRealTimers();
  });

  it('cleans up observers and timers on unmount', () => {
    vi.useFakeTimers();
    const wrapper = mount(MediaControls, { props: defaultProps });

    wrapper.unmount();

    expect(disconnectMock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('updates layout on resize', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });

    global.innerWidth = 500;
    global.innerHeight = 800;
    global.dispatchEvent(new Event('resize'));

    await wrapper.vm.$nextTick();
  });

  it('handles heatmap fetch error', async () => {
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.getHeatmap).mockRejectedValue(new Error('Fetch failed'));

    mount(MediaControls, { props: defaultProps });
    await vi.advanceTimersByTimeAsync(1100);

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch heatmap/metadata',
      expect.any(Error),
    );
    vi.useRealTimers();
  });
});
