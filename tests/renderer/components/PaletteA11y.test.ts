import {
  describe,
  it,
  expect,
  beforeEach,
  beforeAll,
  afterAll,
  vi,
  type Mock,
} from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, toRefs } from 'vue';
import MediaDisplay from '@/components/MediaDisplay.vue';

import SourcesModal from '@/components/SourcesModal.vue';
import AlbumTree from '@/components/AlbumTree.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { useSlideshow } from '@/composables/useSlideshow';
import { api } from '@/api';

// Mock the composables
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/composables/useSlideshow');

// Mock VlcIcon
vi.mock('@/components/icons/VlcIcon.vue', () => ({
  default: { template: '<svg class="vlc-icon-mock"></svg>' },
}));

// Mock API
vi.mock('@/api', () => ({
  api: {
    loadFileAsDataURL: vi.fn(),
    openInVlc: vi.fn(),
    getVideoStreamUrlGenerator: vi.fn(),
    getVideoMetadata: vi.fn(),
    addMediaDirectory: vi.fn(),
    removeMediaDirectory: vi.fn(),
    setDirectoryActiveState: vi.fn(),
    getMediaDirectories: vi.fn(),
    reindexMediaLibrary: vi.fn(),
  },
}));

describe('Palette Accessibility Improvements', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;
  let resizeCallback: any;

  beforeAll(() => {
    // Mock ResizeObserver
    const MockResizeObserver = class ResizeObserver {
      constructor(callback: any) {
        resizeCallback = callback;
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      observe(_target: any) {
        // Trigger initial resize
        if (resizeCallback) {
          resizeCallback([{ contentRect: { width: 1024 } }]);
        }
      }
      disconnect() {}
      unobserve() {}
    };

    global.ResizeObserver = MockResizeObserver;
    window.ResizeObserver = MockResizeObserver;

    // Mock getBoundingClientRect
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 1024,
      height: 768,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    }));
  });

  afterAll(() => {
    delete (global as any).ResizeObserver;
    delete (window as any).ResizeObserver;
  });

  beforeEach(() => {
    // Ensure Desktop size
    window.innerWidth = 1024;
    window.dispatchEvent(new Event('resize'));

    // Setup minimal state for MediaDisplay
    mockLibraryState = reactive({
      totalMediaInPool: 1,
      supportedExtensions: { images: ['.jpg'], videos: ['.mp4'] },
      imageExtensionsSet: new Set(['.jpg']),
      videoExtensionsSet: new Set(['.mp4']),
      mediaDirectories: [],
      allAlbums: [],
      albumsSelectedForSlideshow: {},
      globalMediaPoolForSelection: [],
      mediaUrlGenerator: (p: string) => `http://localhost/media${p}`,
    });

    mockPlayerState = reactive({
      currentMediaItem: { name: 'test.jpg', path: '/test.jpg' },
      displayedMediaFiles: [{ name: 'test.jpg', path: '/test.jpg' }],
      currentMediaIndex: 0,
      isSlideshowActive: true,
      playFullVideo: false,
      pauseTimerOnPlay: false,
      isTimerRunning: false,
      mainVideoElement: null,
      slideshowTimerId: null,
    });

    mockUIState = reactive({
      mediaFilter: 'All',
      isSourcesModalVisible: true,
      isControlsVisible: true,
      isSidebarVisible: false,
    });

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
      // Functions usually returned by store?
      // Based on other tests, we just mock logic.
      // SourcesModal usually calls `libraryStore.addMediaDirectory` etc.
      // I should verify if tests call these.
      // Tests below check `remove-button` labels, but don't seem to trigger actions that require store methods
      // except `toggleAlbumSelection` which is from slideshow mock? No, likely from store in new design?
      // AlbumTree might use store actions.
      // But for now let's just use state as `useAppState` did.
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
      resetState: vi.fn(),
    });

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
      ...toRefs(mockUIState),
      initializeApp: vi.fn(),
    });

    (useSlideshow as Mock).mockReturnValue({
      setFilter: vi.fn(),
      prevMedia: vi.fn(),
      nextMedia: vi.fn(),
      toggleTimer: vi.fn(),
      reapplyFilter: vi.fn(),
      navigateMedia: vi.fn(),
      toggleSlideshowTimer: vi.fn(),
      pauseSlideshowTimer: vi.fn(),
      resumeSlideshowTimer: vi.fn(),
      toggleAlbumSelection: vi.fn(),
      startSlideshow: vi.fn(),
      startIndividualAlbumSlideshow: vi.fn(),
      pickAndDisplayNextMediaItem: vi.fn(),
      filterMedia: vi.fn(),
      selectWeightedRandom: vi.fn(),
      stopSlideshow: vi.fn(),
    });

    vi.clearAllMocks();

    (api.loadFileAsDataURL as Mock).mockResolvedValue({
      type: 'http-url',
      url: 'http://localhost/test.jpg',
    });
    (api.getVideoStreamUrlGenerator as Mock).mockResolvedValue(() => '');
  });

  describe('MediaDisplay.vue', () => {
    it('navigation buttons should have accessible labels', async () => {
      const wrapper = mount(MediaDisplay);

      // Initially at index 0, previous button is disabled with "No previous media"
      const prevBtnDisabled = wrapper.find(
        'button[aria-label="No previous media"]',
      );
      const nextBtn = wrapper.find('button[aria-label="Next media (X)"]');

      expect(prevBtnDisabled.exists()).toBe(true);
      expect(nextBtn.exists()).toBe(true);
      expect(prevBtnDisabled.attributes('aria-label')).toBe(
        'No previous media',
      );
      expect(nextBtn.attributes('aria-label')).toBe('Next media (X)');

      // Verify "Previous media (Z)" appears when index > 0
      mockPlayerState.displayedMediaFiles.push({
        name: 'test2.jpg',
        path: '/test2.jpg',
      });
      mockPlayerState.currentMediaIndex = 1;
      await wrapper.vm.$nextTick();

      const prevBtnEnabled = wrapper.find(
        'button[aria-label="Previous media (Z)"]',
      );
      expect(prevBtnEnabled.exists()).toBe(true);
    });

    it('VLC button should have accessible label', async () => {
      // Need a video to show VLC button
      mockPlayerState.currentMediaItem = {
        name: 'video.mp4',
        path: '/video.mp4',
      };
      // supported exts are already set

      const wrapper = mount(MediaDisplay);
      await wrapper.vm.$nextTick(); // Wait for re-render

      const vlcBtn = wrapper.find('.vlc-button');
      expect(vlcBtn.exists()).toBe(true);
      expect(vlcBtn.attributes('aria-label')).toBe('Open in VLC');
    });

    it('video progress bar should be accessible', async () => {
      // Setup video media
      mockPlayerState.currentMediaItem = {
        name: 'video.mp4',
        path: '/video.mp4',
      };

      const wrapper = mount(MediaDisplay);
      await wrapper.vm.$nextTick(); // Wait for re-render

      const progressBar = wrapper.find('[data-testid="video-progress-bar"]');
      expect(progressBar.exists()).toBe(true);

      // Check ARIA attributes
      expect(progressBar.attributes('role')).toBe('slider');
      expect(progressBar.attributes('tabindex')).toBe('0');
      expect(progressBar.attributes('aria-label')).toBe('Seek video');
      expect(progressBar.attributes('aria-valuemin')).toBe('0');
      expect(progressBar.attributes('aria-valuemax')).toBe('100');
    });

    it('should handle keyboard navigation on progress bar', async () => {
      // Setup video media with a specific duration
      mockPlayerState.currentMediaItem = {
        name: 'video.mp4',
        path: '/video.mp4',
      };
      const wrapper = mount(MediaDisplay);
      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick(); // Wait for video player mount

      const videoWrapper = wrapper.find('video');
      expect(videoWrapper.exists()).toBe(true);
      const videoEl = videoWrapper.element as HTMLVideoElement;

      // Mock duration and currentTime on the real element
      let currentTimeVal = 10;
      Object.defineProperty(videoEl, 'duration', {
        value: 100,
        writable: true,
      });
      Object.defineProperty(videoEl, 'currentTime', {
        get: () => currentTimeVal,
        set: (v) => {
          currentTimeVal = v;
        },
        configurable: true,
      });

      // Update internal state to match video time
      (wrapper.vm as any).savedCurrentTime = 10;
      await wrapper.vm.$nextTick();

      // Ensure propagation
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Ensure MediaDisplay sees the element (it should via normal flow, but let's be safe)
      // (wrapper.vm as any).handleVideoElementUpdate(videoEl);
      // ^ Should typically be handled by @update:video-element

      const progressBar = wrapper.find('[data-testid="video-progress-bar"]');

      // Right arrow - forward 5s
      await progressBar.trigger('keydown', { key: 'ArrowRight' });
      expect(currentTimeVal).toBe(15);

      // Simulate time update
      (wrapper.vm as any).savedCurrentTime = 15;
      await wrapper.vm.$nextTick();

      // Left arrow - backward 5s
      await progressBar.trigger('keydown', { key: 'ArrowLeft' });
      expect(currentTimeVal).toBe(10); // Back to 10

      // Boundary check - min
      currentTimeVal = 2;
      (wrapper.vm as any).savedCurrentTime = 2; // Sync state needed for ProgressBar to know start point
      await wrapper.vm.$nextTick();
      await progressBar.trigger('keydown', { key: 'ArrowLeft' });
      expect(currentTimeVal).toBe(0); // Clamped to 0

      // Boundary check - max
      currentTimeVal = 98;
      (wrapper.vm as any).savedCurrentTime = 98;
      await wrapper.vm.$nextTick();
      await progressBar.trigger('keydown', { key: 'ArrowRight' });
      expect(currentTimeVal).toBe(100); // Clamped to 100
    });
  });

  describe('SourcesModal.vue', () => {
    it('close button should have accessible label', () => {
      const wrapper = mount(SourcesModal);
      const closeBtn = wrapper.find('button[aria-label="Close"]');

      expect(closeBtn.exists()).toBe(true);
      expect(closeBtn.attributes('aria-label')).toBe('Close');
    });

    it('modal container should have accessible role and label', async () => {
      const wrapper = mount(SourcesModal);
      await wrapper.vm.$nextTick();
      const modalOverlay = wrapper.find('div[role="dialog"]');

      expect(modalOverlay.attributes('role')).toBe('dialog');
      expect(modalOverlay.attributes('aria-modal')).toBe('true');
      expect(modalOverlay.attributes('aria-labelledby')).toBe('modal-title');

      const title = wrapper.find('h2');
      expect(title.attributes('id')).toBe('modal-title');
    });

    it('remove buttons should have specific accessible labels', async () => {
      mockLibraryState.mediaDirectories = [
        { path: '/home/user/media', isActive: true },
        { path: '/mnt/data/photos', isActive: false },
      ];

      const wrapper = mount(SourcesModal);
      await wrapper.vm.$nextTick();

      const removeButtons = wrapper.findAll('.remove-button');

      expect(removeButtons.length).toBe(2);
      expect(removeButtons[0].attributes('aria-label')).toBe(
        'Remove /home/user/media',
      );
      expect(removeButtons[1].attributes('aria-label')).toBe(
        'Remove /mnt/data/photos',
      );
    });
  });

  describe('AlbumTree.vue', () => {
    it('toggle button should have accessible label and aria-expanded', async () => {
      const album = {
        id: 'root-id',
        name: 'Root Album',
        children: [
          {
            id: 'child-id',
            name: 'Child',
            textures: [],
            children: [],
          },
        ],
        textures: [],
      };
      const wrapper = mount(AlbumTree, {
        props: {
          album,
          selection: {},
        },
      });

      const toggleBtn = wrapper.find('.toggle-button');
      expect(toggleBtn.exists()).toBe(true);

      // Initial state (collapsed)
      expect(toggleBtn.attributes('aria-label')).toBe('Expand Root Album');
      expect(toggleBtn.attributes('aria-expanded')).toBe('false');
      // Updated to verify SVG icon presence instead of text char
      expect(toggleBtn.find('svg').exists()).toBe(true);
      // Updated rotation logic: rotate-0 (pointing right) -> rotate-90 (pointing down)
      expect(toggleBtn.find('svg').classes()).toContain('rotate-0');

      // Click to expand
      await toggleBtn.trigger('click');
      expect(toggleBtn.attributes('aria-label')).toBe('Collapse Root Album');
      expect(toggleBtn.attributes('aria-expanded')).toBe('true');
      expect(toggleBtn.find('svg').classes()).toContain('rotate-90');
    });

    it('checkbox should have accessible role, label and state', () => {
      const album = {
        id: 'test-id',
        name: 'Test Album',
        children: [],
        textures: [],
      };
      const wrapper = mount(AlbumTree, {
        props: {
          album,
          selection: {},
        },
      });

      const checkbox = wrapper.find('[data-testid="album-checkbox"]');
      expect(checkbox.attributes('role')).toBe('checkbox');
      expect(checkbox.attributes('aria-label')).toBe('Select Test Album');
      expect(checkbox.attributes('aria-checked')).toBe('false');
    });

    it('action buttons should have accessible labels', async () => {
      const album = {
        id: 'test-id',
        name: 'Test Album',
        children: [],
        textures: [],
      };
      const wrapper = mount(AlbumTree, {
        props: {
          album,
          selection: {},
        },
      });

      // Need to hover to see them (opacity 0), but in DOM they exist.
      // We assume tests don't check opacity for existence unless verifying visibility.
      // But we just check attribute presence here.

      const playBtn = wrapper.find('button[title="Play Album"]');
      const gridBtn = wrapper.find('button[title="Open in Grid"]');

      expect(playBtn.exists()).toBe(true);
      expect(playBtn.attributes('aria-label')).toBe('Play Test Album');

      expect(gridBtn.exists()).toBe(true);
      expect(gridBtn.attributes('aria-label')).toBe('Open Test Album in Grid');
    });
  });

  describe('Rating System', () => {
    it('rating buttons should have accessible labels', async () => {
      // Setup media item with existing rating
      mockPlayerState.currentMediaItem = {
        name: 'photo.jpg',
        path: '/photo.jpg',
        rating: 3,
      };

      const wrapper = mount(MediaDisplay);
      await wrapper.vm.$nextTick();

      // The star buttons are inside a div in .media-info
      // usage of aria-label is better/more robust than classes
      const stars = wrapper.findAll('button[aria-label^="Rate"]');
      expect(stars.length).toBe(5);

      // Check labels
      expect(stars[0].attributes('aria-label')).toBe('Rate 1 star');
      expect(stars[1].attributes('aria-label')).toBe('Rate 2 stars');
      expect(stars[4].attributes('aria-label')).toBe('Rate 5 stars');
    });
  });
});
