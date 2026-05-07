import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, nextTick, computed } from 'vue';
import App from '@/App.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { useAuthStore } from '@/composables/useAuthStore';
import { useTheme } from '@/composables/useTheme';

// Mock the composables
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/composables/useAuthStore');
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
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  let initializeApp: Mock;
  let navigateMedia: Mock;
  let toggleSlideshowTimer: Mock;
  let mockCycleTheme: Mock;

  beforeEach(() => {
    initializeApp = vi.fn().mockResolvedValue(undefined);
    navigateMedia = vi.fn();
    toggleSlideshowTimer = vi.fn();
    mockCycleTheme = vi.fn();

    (useTheme as Mock).mockReturnValue({
      initTheme: vi.fn(),
      cycleTheme: mockCycleTheme,
      applyTheme: vi.fn(),
      cleanupTheme: vi.fn(),
    });

    mockLibraryState = reactive({
      allAlbums: [],
      albumsSelectedForSlideshow: {},
      isScanning: false,
      smartPlaylists: [],
      globalMediaPoolForSelection: [],
      totalMediaInPool: 0,
      mediaDirectories: [],
      supportedExtensions: {
        images: ['.jpg'],
        videos: ['.mp4'],
      },
      initializeApp,
    });

    mockPlayerState = reactive({
      currentMediaItem: null,
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      isSlideshowActive: false,
      isTimerRunning: false,
      timerDuration: 30,
      slideshowTimerId: null,
      stopSlideshow: vi.fn(),
      mainVideoElement: null,
    });

    mockUIState = reactive({
      isSourcesModalVisible: false,
      viewMode: 'player',
      isSmartPlaylistModalVisible: false,
      mediaFilter: 'All',
      isControlsVisible: true,
      isSidebarVisible: true,
      themeMode: 'system',
    });

    (useLibraryStore as unknown as Mock).mockReturnValue(Object.assign(mockLibraryState, {
      loadInitialData: initializeApp,
    }));

    (usePlayerStore as unknown as Mock).mockReturnValue(Object.assign(mockPlayerState, {
      stopSlideshow: vi.fn(),
      pauseTimerOnPlay: { value: false },
    }));

    (useUIStore as unknown as Mock).mockReturnValue(Object.assign(mockUIState, {
      setThemeMode: vi.fn(),
      themeMode: { value: 'system' },
    }));

    (useAuthStore as unknown as Mock).mockReturnValue({
      isLocked: computed(() => false),
      isInitialized: computed(() => true),
      checkLockStatus: vi.fn().mockResolvedValue(undefined),
    });

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
    mockUIState.viewMode = 'player';
    const wrapper = mount(App);
    expect(wrapper.find('.media-display-mock').exists()).toBe(true);
    expect(wrapper.find('.media-grid-mock').exists()).toBe(false);
  });

  it('should render MediaGrid component when viewMode is grid', () => {
    mockUIState.viewMode = 'grid';
    const wrapper = mount(App);
    expect(wrapper.find('.media-grid-mock').exists()).toBe(true);
    expect(wrapper.find('.media-display-mock').exists()).toBe(false);
  });

  it('should render SourcesModal component', () => {
    const wrapper = mount(App);
    expect(wrapper.find('.sources-modal-mock').exists()).toBe(true);
  });

  it('should render LoadingMask when isScanning is true', async () => {
    mockLibraryState.isScanning = true;
    const wrapper = mount(App);
    await nextTick();
    expect(wrapper.find('.loading-mask-mock').exists()).toBe(true);
  });

  it('should NOT render LoadingMask when isScanning is false', async () => {
    mockLibraryState.isScanning = false;
    const wrapper = mount(App);
    await nextTick();
    expect(wrapper.find('.loading-mask-mock').exists()).toBe(false);
  });

  it('should call initializeApp on mount', async () => {
    mount(App);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(initializeApp).toHaveBeenCalled();
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
    mockUIState.viewMode = 'grid'; // Ensure grid mode for App global key handling
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
    expect(mockUIState.isSidebarVisible).toBe(true);

    // Simulate slideshow starting
    mockPlayerState.isSlideshowActive = true;
    await nextTick();

    expect(mockUIState.isSidebarVisible).toBe(false);
  });

  describe('Controls Visibility interactions', () => {
    it('shows controls on mousemove and hides after timeout if video playing', async () => {
      vi.useFakeTimers();
      mockUIState.viewMode = 'player';
      mockUIState.isControlsVisible = false;
      // Mock video playing
      mockPlayerState.mainVideoElement = { paused: false };
      await nextTick();

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      await mainDiv.trigger('mousemove');
      expect(mockUIState.isControlsVisible).toBe(true);

      vi.advanceTimersByTime(3500);
      expect(mockUIState.isControlsVisible).toBe(false);
      vi.useRealTimers();
    });

    it('keeps controls visible on mousemove timeout if video is PAUSED', async () => {
      vi.useFakeTimers();
      mockUIState.viewMode = 'player';
      mockUIState.isControlsVisible = false;
      // Mock video paused
      mockPlayerState.mainVideoElement = { paused: true };

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      await mainDiv.trigger('mousemove');
      expect(mockUIState.isControlsVisible).toBe(true);

      vi.advanceTimersByTime(3500);
      // Should still be visible because video is paused
      expect(mockUIState.isControlsVisible).toBe(true);
      vi.useRealTimers();
    });

    it('hides controls on mouseleave if video playing', async () => {
      mockUIState.viewMode = 'player';
      mockUIState.isControlsVisible = true;
      mockPlayerState.mainVideoElement = { paused: false };
      await nextTick();

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      expect(mainDiv.exists()).toBe(true);
      await mainDiv.trigger('mouseleave');
      expect(mockUIState.isControlsVisible).toBe(false);
    });

    it('keeps controls visible on mouseleave if video PAUSED', async () => {
      mockUIState.viewMode = 'player';
      mockUIState.isControlsVisible = true;
      mockPlayerState.mainVideoElement = { paused: true };
      await nextTick();

      const wrapper = mount(App);
      const mainDiv = wrapper.find('[data-testid="main-content-area"]');

      await mainDiv.trigger('mouseleave');
      expect(mockUIState.isControlsVisible).toBe(true);
    });
  });
});
