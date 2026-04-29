import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { reactive, toRefs, computed, ref } from 'vue';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useMediaLoader } from '@/composables/useMediaLoader';
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
vi.mock('@/composables/usePlaylistStore');
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useMediaLoader');

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    (ResizeObserverMock as any).lastCallback = callback;
  }
}
(ResizeObserverMock as any).lastCallback = null;
global.ResizeObserver = ResizeObserverMock as any;

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
    getThumbnailUrlGenerator: vi.fn(),
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
  let mockPlaylistState: any;
  let mockUIState: any;

  beforeEach(() => {
    // Ensure "Desktop" mode by default
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    });

    mockLibraryState = reactive({
      imageExtensionsSet: new Set(['.jpg', '.png']),
      videoExtensionsSet: new Set(['.mp4', '.mkv']),
      mediaDirectories: [],
      thumbnailUrlGenerator: vi.fn(),
    });

    mockPlaylistState = reactive({
      currentItem: { name: 'test.mp4', path: '/test.mp4' },
      history: [],
      queue: [{ name: 'next.mp4', path: '/next.mp4' }],
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: 0,
      isPlaying: false,
      isSlideshowActive: false,
      isTimerRunning: false,
      mainVideoElement: null,
      slideshowTimerId: null,
      currentMediaItem: { name: 'test.mp4', path: '/test.mp4' },
    });

    mockUIState = reactive({
      isControlsVisible: true,
      isSourcesModalVisible: false,
      isSidebarVisible: false,
      viewMode: 'player',
      gridMediaFiles: [], // Add this to prevent GridView crash
    });

    (useLibraryStore as Mock).mockReturnValue({
      ...toRefs(mockLibraryState),
      imageExtensionsSet: computed(() => mockLibraryState.imageExtensionsSet),
      mediaDirectories: computed(() => mockLibraryState.mediaDirectories),
    });

    (usePlayerStore as Mock).mockReturnValue({
      ...toRefs(mockPlayerState),
      pauseTimerOnPlay: ref(false),
      isTimerRunning: computed(() => mockPlayerState.isTimerRunning),
    });

    (useUIStore as Mock).mockReturnValue({
      ...toRefs(mockUIState),
      state: mockUIState, // Add state object for GridView
    });

    (usePlaylistStore as Mock).mockReturnValue({
      currentItem: computed(() => mockPlaylistState.currentItem),
      hasPrevious: computed(() => mockPlaylistState.history.length > 0),
      hasNext: computed(() => mockPlaylistState.queue.length > 0),
      setQueue: vi.fn(),
      playNext: vi.fn((item: any) => {
        mockPlayerState.currentMediaItem = item;
      }),
      playPrevious: vi.fn(),
      clearPlaylist: vi.fn(),
      state: mockPlaylistState,
      ...toRefs(mockPlaylistState),
    });

    (useSlideshow as Mock).mockReturnValue({
      navigateMedia: vi.fn(),
      pauseSlideshowTimer: vi.fn(),
      resumeSlideshowTimer: vi.fn(),
      toggleSlideshowTimer: vi.fn(),
      stopSlideshow: vi.fn(),
      openAlbumInGrid: vi.fn(),
    });

    (useMediaLoader as Mock).mockReturnValue({
      isLoading: ref(false),
      mediaUrl: ref('test.mp4'),
      error: ref(null),
      isVideoSupported: ref(true),
      loadMedia: vi.fn(),
    });

    vi.clearAllMocks();

    (api.loadFileAsDataURL as Mock).mockResolvedValue({
      url: 'http://localhost/test.mp4',
    });
    (api.getVideoStreamUrlGenerator as Mock).mockResolvedValue(() => '');
    (api.getThumbnailUrlGenerator as any).mockResolvedValue(
      (path: string) => `thumb://${path}`,
    );
  });

  const commonMountOptions = {
    global: {
      stubs: {
        Teleport: true,
      },
    },
  };

  describe('MediaDisplay.vue', () => {
    it('navigation buttons should have accessible labels', async () => {
      const wrapper = mount(MediaDisplay, commonMountOptions);

      // Add historical item to enable "Previous"
      mockPlaylistState.history.push({ name: 'prev.mp4', path: '/prev.mp4' });
      await wrapper.vm.$nextTick();

      // Trigger ResizeObserver callback manually to ensure stars & buttons are evaluated
      const observerCallback = (ResizeObserverMock as any).lastCallback;
      if (observerCallback) {
        observerCallback([{ contentRect: { width: 1000, height: 800 } }]);
        await wrapper.vm.$nextTick();
      }

      expect(
        wrapper.find('button[aria-label="Previous media (Z)"]').exists() ||
          wrapper.find('button[title="Previous media (Z)"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('button[aria-label="Next media (X)"]').exists() ||
          wrapper.find('button[title="Next media (X)"]').exists(),
      ).toBe(true);
    });

    it('VLC button should have accessible label', async () => {
      const wrapper = mount(MediaDisplay, commonMountOptions);

      const observerCallback = (ResizeObserverMock as any).lastCallback;
      if (observerCallback) {
        observerCallback([{ contentRect: { width: 1000, height: 800 } }]);
        await wrapper.vm.$nextTick();
      }

      const vlcButton = wrapper.find('.vlc-button');
      expect(vlcButton.exists()).toBe(true);
      expect(vlcButton.attributes('aria-label')).toBe('Open in VLC');
    });

    it('video progress bar should be accessible', () => {
      const wrapper = mount(MediaDisplay, commonMountOptions);
      const progressBar = wrapper.find('[role="slider"]');
      expect(progressBar.exists()).toBe(true);
      expect(progressBar.attributes('aria-label')).toBe('Seek video');
    });

    it('should handle keyboard navigation on progress bar', async () => {
      const wrapper = mount(MediaDisplay, commonMountOptions);
      const progressBar = wrapper.find('[role="slider"]');
      await progressBar.trigger('keydown', { key: 'ArrowRight' });
      expect(progressBar.exists()).toBe(true);
    });
  });

  describe('SourcesModal.vue', () => {
    it('close button should have accessible label', () => {
      mockUIState.isSourcesModalVisible = true;
      const wrapper = mount(SourcesModal);
      const closeButton = wrapper.find('button[aria-label="Close"]');
      expect(closeButton.exists()).toBe(true);
    });

    it('modal container should have accessible role and label reference', () => {
      mockUIState.isSourcesModalVisible = true;
      const wrapper = mount(SourcesModal);
      const modal = wrapper.find('[role="dialog"]');
      expect(modal.exists()).toBe(true);
      expect(modal.attributes('aria-labelledby')).toBe('modal-title');
    });

    it('remove buttons should have specific accessible labels', async () => {
      mockUIState.isSourcesModalVisible = true;
      mockLibraryState.mediaDirectories = [
        { path: '/movies', active: true, name: 'Movies' },
        { path: '/tv', active: false, name: 'TV' },
      ];
      const wrapper = mount(SourcesModal);
      const removeButtons = wrapper.findAll('.remove-button');
      expect(removeButtons.length).toBe(2);
      expect(removeButtons[0].attributes('aria-label')).toBe('Remove /movies');
    });
  });

  describe('AlbumTree.vue', () => {
    const mockAlbum: any = {
      id: 'album-1',
      name: 'Holiday 2023',
      path: '/holiday',
      isOpen: false,
      isSelected: false,
      textures: [],
      children: [],
    };

    it('toggle button should have accessible label and aria-expanded', () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: { ...mockAlbum, children: [{ id: 'child' }] },
          depth: 0,
          selection: {},
        },
      });
      const toggleBtn = wrapper.find('.toggle-button');
      expect(toggleBtn.exists()).toBe(true);
      expect(toggleBtn.attributes('aria-expanded')).toBe('false');
      expect(toggleBtn.attributes('aria-label')).toBe('Expand Holiday 2023');
    });

    it('checkbox should have accessible role, label and state', () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: mockAlbum,
          depth: 0,
          selection: { [mockAlbum.id]: true },
        },
      });
      const checkbox = wrapper.find('[role="checkbox"]');
      expect(checkbox.exists()).toBe(true);
      expect(checkbox.attributes('aria-checked')).toBe('true');
      expect(checkbox.attributes('aria-label')).toBe('Select Holiday 2023');
    });

    it('action buttons should have accessible labels', () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: mockAlbum,
          depth: 0,
          selection: {},
        },
      });
      expect(
        wrapper.find('button[aria-label="Play Holiday 2023"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('button[aria-label="Open Holiday 2023 in Grid"]').exists(),
      ).toBe(true);
    });
  });

  describe('Rating System', () => {
    it('rating buttons should have accessible labels', async () => {
      const wrapper = mount(MediaDisplay, commonMountOptions);

      // Ensure we trigger ResizeObserver for stars
      const observerCallback = (ResizeObserverMock as any).lastCallback;
      if (observerCallback) {
        observerCallback([{ contentRect: { width: 1000, height: 800 } }]);
        await wrapper.vm.$nextTick();
      }

      const starButtons = wrapper.findAll('button[title^="Rate"]');
      expect(starButtons.length).toBe(5);
      expect(starButtons[2].attributes('aria-label')).toMatch(/Rate 3 stars/);
    });
  });
});
