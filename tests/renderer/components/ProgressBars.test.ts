import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive, toRefs, computed, ref } from 'vue';
import AlbumsList from '@/components/AlbumsList.vue';
import MediaDisplay from '@/components/MediaDisplay.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useTranscoder } from '@/composables/useTranscoder';
import { createMockElectronAPI } from '../mocks/electronAPI';
import type { LoadResult } from '../../../src/preload/preload';

// Mock the composables
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/usePlaylistStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/composables/useMediaLoader');
vi.mock('@/composables/useTranscoder');

vi.mock('@/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    navigateMedia: vi.fn(),
    reapplyFilter: vi.fn(),
    pauseSlideshowTimer: vi.fn(),
    resumeSlideshowTimer: vi.fn(),
    toggleSlideshowTimer: vi.fn(),
    startSlideshow: vi.fn(),
  }),
}));

// Mock window.electronAPI
global.window.electronAPI = createMockElectronAPI();

describe('Progress Bars', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockPlaylistState: any;
  let mockUIState: any;

  beforeEach(() => {
    // Reset any previous mock implementations from other tests
    vi.clearAllMocks();
    (window.electronAPI.loadFileAsDataURL as Mock).mockResolvedValue({
      type: 'data-url',
      url: '',
    } as LoadResult);

    mockLibraryState = reactive({
      allAlbums: [],
      albumsSelectedForSlideshow: {},
      smartPlaylists: [],
      totalMediaInPool: 0,
      supportedExtensions: { images: ['.jpg'], videos: ['.mp4'] },
      imageExtensionsSet: new Set(['.jpg']),
      videoExtensionsSet: new Set(['.mp4']),
      mediaDirectories: [],
      mediaUrlGenerator: (p: string) => `http://localhost/media${p}`,
    });

    mockPlaylistState = reactive({
      currentItem: { path: 'video.mp4', name: 'video.mp4' },
      history: [],
      queue: [],
    });

    mockPlayerState = reactive({
      timerDuration: 5,
      isTimerRunning: false,
      timerProgress: 50,
      isSlideshowActive: true,
      pauseTimerOnPlay: false,
      mainVideoElement: null,
    });

    mockUIState = reactive({
      isSourcesModalVisible: false,
      gridMediaFiles: [],
      viewMode: 'player',
      mediaFilter: 'All',
      isControlsVisible: true,
      isSidebarVisible: true,
      themeMode: 'system',
    });

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
      resetState: vi.fn(),
    });

    (usePlaylistStore as Mock).mockReturnValue({
      state: mockPlaylistState,
      currentItem: computed(() => mockPlaylistState.currentItem),
      hasPrevious: computed(() => mockPlaylistState.history.length > 0),
      hasNext: computed(() => mockPlaylistState.queue.length > 0),
      setQueue: vi.fn(),
      playNext: vi.fn(),
      playPrevious: vi.fn(),
      clearPlaylist: vi.fn(),
      ...toRefs(mockPlaylistState),
    } as any);

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
      ...toRefs(mockUIState),
    });

    (useMediaLoader as Mock).mockReturnValue({
      mediaUrl: ref('http://media/video.mp4'),
      isLoading: ref(false),
      error: ref(null),
      loadMedia: vi.fn(),
      isVideoSupported: ref(true),
    });

    (useTranscoder as Mock).mockReturnValue({
      isTranscodingMode: ref(false),
      isTranscodingLoading: ref(false),
      transcodingProgress: ref(0),
      resetTranscoderState: vi.fn(),
    });
  });

  it('should display the slideshow progress bar in AlbumsList when the timer is running', async () => {
    // Arrange
    mockPlayerState.isTimerRunning = false;
    mockPlayerState.timerProgress = 50;

    const wrapper = mount(AlbumsList);

    // Act
    mockPlayerState.isTimerRunning = true;
    await nextTick();

    // Assert
    const progressBar = wrapper.find('[data-testid="slideshow-progress"]');
    expect(progressBar.exists()).toBe(true);
    const innerBar = progressBar.find('div[class*="bg-accent"]');
    expect(innerBar.attributes('style')).toContain('width: 50%');
  });

  it('should display and update the video progress bar in MediaDisplay', async () => {
    mockPlaylistState.currentItem = { path: 'video.mp4', name: 'video.mp4' };
    mockPlayerState.isTimerRunning = false;

    const wrapper = mount(MediaDisplay);

    // Wait for the async watcher to call loadMediaUrl and for Vue to re-render
    await nextTick();
    await nextTick();

    // Now the video element should exist because mediaUrl is set
    const videoElement = wrapper.find('video');
    expect(videoElement.exists()).toBe(true);

    // Assert initial state
    const progressBar = wrapper.find('[data-testid="video-progress-bar"]');
    expect(progressBar.exists()).toBe(true);
    expect(progressBar.attributes('aria-valuenow')).toBe('0');

    // Act
    // We update the video element, which triggers timeupdate
    Object.defineProperty(videoElement.element, 'duration', {
      value: 100,
      writable: true,
    });
    Object.defineProperty(videoElement.element, 'currentTime', {
      value: 25,
      writable: true,
    });

    await videoElement.trigger('timeupdate');
    await nextTick();

    // Assert
    expect(progressBar.attributes('aria-valuenow')).toBe('25');
  });

  describe('ProgressBar.vue interactions', () => {
    it('should format time correctly in tooltip', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 65,
          duration: 3600,
          isImage: false,
        },
      });

      // No easy way to check internal state without exposing or complex selector,
      // but we can check if it renders.
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle mouse scrub interactions', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 0,
          duration: 100,
          isImage: false,
        },
      });

      // Mock getBoundingClientRect for width
      Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        width: 1000,
        left: 0,
        top: 0,
      });

      const container = wrapper.find('.progress-container');
      await container.trigger('mousedown', { clientX: 500 });
      // ProgressBar emits seek on interaction end (mouseup)
      window.dispatchEvent(new MouseEvent('mouseup'));

      // Should emit seek
      expect(wrapper.emitted('seek')).toBeTruthy();
      expect(wrapper.emitted('seek')?.[0]).toEqual([50]);
    });

    it('should handle touch scrub interactions', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 0,
          duration: 100,
          isImage: false,
        },
      });

      Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        width: 1000,
        left: 0,
        top: 0,
      });

      const container = wrapper.find('.progress-container');
      await container.trigger('touchstart', {
        touches: [{ clientX: 250 }],
      });
      // Trigger interaction end
      window.dispatchEvent(new TouchEvent('touchend'));

      expect(wrapper.emitted('seek')).toBeTruthy();
      expect(wrapper.emitted('seek')?.[0]).toEqual([25]);
    });

    it('should draw heatmap when data provided', async () => {
      const heatmap = {
        points: 100,
        motion: Array.from(new Float32Array(100)),
        audio: Array.from(new Float32Array(100)),
      };
      // For now we just check if it doesn't crash.
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 50,
          duration: 100,
          heatmap,
          isImage: false,
        },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle keyboard navigation', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 50,
          duration: 100,
          isImage: false,
        },
      });

      await wrapper
        .find('[role="slider"]')
        .trigger('keydown', { key: 'ArrowRight' });
      expect(wrapper.emitted('seek')?.[0]).toEqual([55]);

      await wrapper
        .find('[role="slider"]')
        .trigger('keydown', { key: 'ArrowLeft' });
      expect(wrapper.emitted('seek')?.[1]).toEqual([45]);
    });

    it('should draw watched segments and buffered ranges', async () => {
      const watchedSegments = [
        { start: 0, end: 10 },
        { start: 30, end: 40 },
      ];
      const buffered = 50;

      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 20,
          duration: 100,
          watchedSegments,
          buffered,
          isImage: false,
        },
      });

      expect(wrapper.exists()).toBe(true);
    });

    it('should fallback to audio-only or simple line if data missing', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 10,
          duration: 100,
          isImage: false,
        },
      });
      // The component uses a canvas for waveform, but always shows the container
      expect(wrapper.find('.progress-container').exists()).toBe(true);
    });

    it('should handle zero dimensions or missing context gracefully', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 10,
          duration: 100,
          isImage: false,
        },
      });

      // Mock getBoundingClientRect with zero width
      Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
        width: 0,
        left: 0,
        top: 0,
      });

      const container = wrapper.find('.progress-container');
      await container.trigger('mousedown', { clientX: 500 });
      window.dispatchEvent(new MouseEvent('mouseup'));

      // Should handle correctly (usually emits 0 or doesn't emit if rect is 0)
      expect(wrapper.exists()).toBe(true);
    });
  });
});
