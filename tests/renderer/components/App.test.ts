import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import App from '@/App.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { useAuthStore } from '@/composables/useAuthStore';
import { useTheme } from '@/composables/useTheme';

// Mock the non-Pinia composables
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useTheme');

// Mock the child components
vi.mock('@/components/AlbumsList.vue', () => ({
  default: { template: '<div class="albums-list-mock">AlbumsList</div>' },
}));
vi.mock('@/components/MediaDisplay.vue', () => ({
  default: { template: '<div class="media-display-mock">MediaDisplay</div>' },
}));
vi.mock('@/components/MediaGrid.vue', () => ({
  default: { template: '<div class="media-grid-mock">MediaGrid</div>' },
}));
vi.mock('@/components/SourcesModal.vue', () => ({
  default: { template: '<div class="sources-modal-mock">SourcesModal</div>' },
}));
vi.mock('@/components/LoadingMask.vue', () => ({
  default: { template: '<div class="loading-mask-mock">LoadingMask</div>' },
}));
vi.mock('@/components/AmbientBackground.vue', () => ({
  default: {
    template: '<div class="ambient-background-mock">AmbientBackground</div>',
  },
}));

describe('App.vue', () => {
  let navigateMedia: Mock;
  let toggleSlideshowTimer: Mock;
  let mockCycleTheme: Mock;

  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    navigateMedia = vi.fn();
    toggleSlideshowTimer = vi.fn();
    mockCycleTheme = vi.fn();

    (useTheme as Mock).mockReturnValue({
      initTheme: vi.fn(),
      cycleTheme: mockCycleTheme,
      applyTheme: vi.fn(),
      cleanupTheme: vi.fn(),
    });

    // Set initial store state
    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().isScanning = false;
    useLibraryStore().smartPlaylists = [];
    useLibraryStore().globalMediaPoolForSelection = [];
    useLibraryStore().totalMediaInPool = 0;
    useLibraryStore().mediaDirectories = [];
    useLibraryStore().supportedExtensions = {
      images: ['.jpg'],
      videos: ['.mp4'],
      all: ['.jpg', '.mp4'],
    };

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().timerDuration = 30;
    usePlayerStore().slideshowTimerId = null;
    usePlayerStore().mainVideoElement = null;

    useUIStore().isSourcesModalVisible = false;
    useUIStore().viewMode = 'player';
    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().mediaFilter = 'All';
    useUIStore().isControlsVisible = true;
    useUIStore().isSidebarVisible = true;
    useUIStore().themeMode = 'system';

    useAuthStore().isLocked = false;
    useAuthStore().isInitialized = true;

    (useSlideshow as Mock).mockReturnValue({
      navigateMedia,
      toggleSlideshowTimer,
      toggleAlbumSelection: vi.fn(),
      startSlideshow: vi.fn(),
      startIndividualAlbumSlideshow: vi.fn(),
      setFilter: vi.fn(),
      prevMedia: vi.fn(),
      nextMedia: vi.fn(),
      reapplyFilter: vi.fn(),
      pickAndDisplayNextMediaItem: vi.fn(),
      filterMedia: vi.fn(),
      selectWeightedRandom: vi.fn(),
    });
  });

  it('should render the app title', () => {
    const wrapper = mount(App);
    expect(wrapper.find('h1').text()).toBe('MediaPlayer');
  });

  it('should render a skip to content link', () => {
    const wrapper = mount(App);
    const skipLink = wrapper.find('a[href="#main-content"]');
    expect(skipLink.exists()).toBe(true);
    expect(skipLink.text()).toBe('Skip to content');

    const mainContent = wrapper.find('#main-content');
    expect(mainContent.attributes('tabindex')).toBe('-1');
  });

  it('should render AlbumsList component', () => {
    const wrapper = mount(App);
    expect(wrapper.find('.albums-list-mock').exists()).toBe(true);
  });

  it('should render MediaDisplay component when viewMode is player', () => {
    useUIStore().viewMode = 'player';
    const wrapper = mount(App);
    expect(wrapper.find('.media-display-mock').exists()).toBe(true);
    expect(wrapper.find('.media-grid-mock').exists()).toBe(false);
  });

  it('should render MediaGrid component when viewMode is grid', () => {
    useUIStore().viewMode = 'grid';
    const wrapper = mount(App);
    expect(wrapper.find('.media-grid-mock').exists()).toBe(true);
    expect(wrapper.find('.media-display-mock').exists()).toBe(false);
  });

  it('should render SourcesModal component', () => {
    const wrapper = mount(App);
    expect(wrapper.find('.sources-modal-mock').exists()).toBe(true);
  });

  it('should render LoadingMask when isScanning is true', async () => {
    useLibraryStore().isScanning = true;
    const wrapper = mount(App);
    await nextTick();
    expect(wrapper.find('.loading-mask-mock').exists()).toBe(true);
  });

  it('should NOT render LoadingMask when isScanning is false', async () => {
    useLibraryStore().isScanning = false;
    const wrapper = mount(App);
    await nextTick();
    expect(wrapper.find('.loading-mask-mock').exists()).toBe(false);
  });

  it('should call initializeApp on mount', async () => {
    mount(App);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useLibraryStore().loadInitialData).toHaveBeenCalled();
  });

  it('should handle "z" key for previous media', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event = new KeyboardEvent('keydown', { key: 'z' });
    document.dispatchEvent(event);

    expect(navigateMedia).toHaveBeenCalledWith(-1);
    wrapper.unmount();
  });

  it('should handle "x" key for next media', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event = new KeyboardEvent('keydown', { key: 'x' });
    document.dispatchEvent(event);

    expect(navigateMedia).toHaveBeenCalledWith(1);
    wrapper.unmount();
  });

  it('should handle space key for timer toggle', async () => {
    useUIStore().viewMode = 'grid'; // Ensure grid mode for App global key handling
    const wrapper = mount(App, { attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event = new KeyboardEvent('keydown', { key: ' ' });
    document.dispatchEvent(event);

    expect(toggleSlideshowTimer).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('should not handle keys when typing in input', async () => {
    const wrapper = mount(App, { attachTo: document.body });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Create an input element and simulate event from it
    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
    });
    Object.defineProperty(event, 'target', { value: input, enumerable: true });

    document.dispatchEvent(event);

    expect(navigateMedia).not.toHaveBeenCalled();

    document.body.removeChild(input);
    wrapper.unmount();
  });

  it('should remove event listener on unmount', async () => {
    const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
    const wrapper = mount(App);
    await new Promise((resolve) => setTimeout(resolve, 0));

    wrapper.unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
    removeEventListenerSpy.mockRestore();
  });

  it('should auto-close sidebar when slideshow becomes active', async () => {
    mount(App);
    // Initially sidebar is open
    expect(useUIStore().isSidebarVisible).toBe(true);

    // Simulate slideshow starting
    usePlayerStore().isSlideshowActive = true;
    await nextTick();

    expect(useUIStore().isSidebarVisible).toBe(false);
  });

  describe('Controls Visibility interactions', () => {
    it('shows controls on mousemove and hides after timeout if video playing', async () => {
      vi.useFakeTimers();
      useUIStore().viewMode = 'player';
      useUIStore().isControlsVisible = false;
      // Mock video playing
      usePlayerStore().mainVideoElement = { paused: false } as HTMLVideoElement;
      await nextTick();

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      await mainDiv.trigger('mousemove');
      expect(useUIStore().isControlsVisible).toBe(true);

      vi.advanceTimersByTime(3500);
      expect(useUIStore().isControlsVisible).toBe(false);
      vi.useRealTimers();
    });

    it('keeps controls visible on mousemove timeout if video is PAUSED', async () => {
      vi.useFakeTimers();
      useUIStore().viewMode = 'player';
      useUIStore().isControlsVisible = false;
      // Mock video paused
      usePlayerStore().mainVideoElement = { paused: true } as HTMLVideoElement;

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      await mainDiv.trigger('mousemove');
      expect(useUIStore().isControlsVisible).toBe(true);

      vi.advanceTimersByTime(3500);
      // Should still be visible because video is paused
      expect(useUIStore().isControlsVisible).toBe(true);
      vi.useRealTimers();
    });

    it('hides controls on mouseleave if video playing', async () => {
      useUIStore().viewMode = 'player';
      useUIStore().isControlsVisible = true;
      usePlayerStore().mainVideoElement = { paused: false } as HTMLVideoElement;
      await nextTick();

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      expect(mainDiv.exists()).toBe(true);
      await mainDiv.trigger('mouseleave');
      expect(useUIStore().isControlsVisible).toBe(false);
    });

    it('keeps controls visible on mouseleave if video PAUSED', async () => {
      useUIStore().viewMode = 'player';
      useUIStore().isControlsVisible = true;
      usePlayerStore().mainVideoElement = { paused: true } as HTMLVideoElement;
      await nextTick();

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      await mainDiv.trigger('mouseleave');
      expect(useUIStore().isControlsVisible).toBe(true);
    });
  });
});
