import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive, toRefs } from 'vue';
import AlbumsList from '@/components/AlbumsList.vue';
import MediaDisplay from '@/components/MediaDisplay.vue';
import ProgressBar from '@/components/ProgressBar.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { createMockElectronAPI } from '../mocks/electronAPI';
import type { LoadResult } from '../../../src/preload/preload';

// Mock the composables
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');

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

    mockPlayerState = reactive({
      timerDuration: 5,
      isTimerRunning: false,
      timerProgress: 50,
      currentMediaItem: { path: 'video.mp4', name: 'video.mp4' },
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      isSlideshowActive: true,
      playFullVideo: false,
      pauseTimerOnPlay: false,
      mainVideoElement: null,
      isLoading: false,
    });

    mockUIState = reactive({
      isSourcesModalVisible: false,
      gridMediaFiles: [],
      viewMode: 'player',
      mediaFilter: 'All',
      isControlsVisible: true,
      isSidebarVisible: true,
    });

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
    });

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
      ...toRefs(mockUIState),
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
    const innerBar = progressBar.find('div.bg-indigo-500');
    expect(innerBar.attributes('style')).toContain('width: 50%');
  });

  it('should display and update the video progress bar in MediaDisplay', async () => {
    // Arrange
    (window.electronAPI.loadFileAsDataURL as Mock).mockResolvedValue({
      type: 'http-url',
      url: 'fake-video-url.mp4',
    } as LoadResult);

    mockPlayerState.currentMediaItem = { path: 'video.mp4', name: 'video.mp4' };
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
      value: 200,
      writable: true,
    });
    Object.defineProperty(videoElement.element, 'currentTime', {
      value: 50,
      writable: true,
    });

    // Trigger timeupdate on the video element
    await videoElement.trigger('timeupdate');
    await nextTick();
    await nextTick(); // Wait for any watchers/computeds

    // Assert updated state
    // 50 / 200 = 25%
    expect(progressBar.attributes('aria-valuenow')).toBe('25');
  });

  describe('ProgressBar.vue interactions', () => {
    it('should format time correctly in tooltip', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 0, duration: 100 },
      });
      await nextTick();

      // Simulate hover
      await wrapper.trigger('mouseenter');

      // Default time is 0
      expect(wrapper.text()).toContain('0:00');
    });

    it('should handle mouse scrub interactions', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 0, duration: 100 },
      });
      const progressBarEl = wrapper.find('.progress-container');

      // Mock getBoundingClientRect
      const mockRect = {
        left: 0,
        width: 100,
        bottom: 0,
        height: 10,
        right: 100,
        top: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      };
      vi.spyOn(progressBarEl.element, 'getBoundingClientRect').mockReturnValue(
        mockRect,
      );

      // 1. Mouse Down at 50px (50%)
      await progressBarEl.trigger('mousedown', { clientX: 50 });

      expect(wrapper.emitted('scrub-start')).toBeTruthy();
      expect((wrapper.vm as any).isDragging).toBe(true);
      expect((wrapper.vm as any).localPreviewTime).toBe(50);

      // 2. Mouse Move to 75px (75%)
      const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 75 });
      Object.defineProperty(mouseMoveEvent, 'target', {
        value: progressBarEl.element,
        writable: true,
      });
      window.dispatchEvent(mouseMoveEvent);
      await nextTick();
      expect((wrapper.vm as any).localPreviewTime).toBe(75);

      // 3. Mouse Up
      const mouseUpEvent = new MouseEvent('mouseup');
      // For mouseup, target might not matter if handleInteractionEnd doesn't use it,
      // but let's be safe if future logic does.
      window.dispatchEvent(mouseUpEvent);
      await nextTick();

      const seekEvents = wrapper.emitted('seek');
      expect(seekEvents).toBeTruthy();
      expect(seekEvents![0]).toEqual([75]);
      expect(wrapper.emitted('scrub-end')).toBeTruthy();
      expect((wrapper.vm as any).isDragging).toBe(false);
    });

    it('should handle touch scrub interactions', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 0, duration: 100 },
      });
      const progressBarEl = wrapper.find('.progress-container');

      // Mock getBoundingClientRect
      const mockRect = {
        left: 0,
        width: 100,
        bottom: 0,
        height: 10,
        right: 100,
        top: 0,
        x: 0,
        y: 0,
        toJSON: () => {},
      };
      vi.spyOn(progressBarEl.element, 'getBoundingClientRect').mockReturnValue(
        mockRect,
      );

      // 1. Touch Start at 20px
      const touchStartEvent = new TouchEvent('touchstart', {
        touches: [{ clientX: 20 }] as any,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(touchStartEvent, 'target', {
        value: progressBarEl.element,
        writable: true,
      });
      progressBarEl.element.dispatchEvent(touchStartEvent);

      expect(wrapper.emitted('scrub-start')).toBeTruthy();
      expect((wrapper.vm as any).isDragging).toBe(true);
      expect((wrapper.vm as any).localPreviewTime).toBe(20);

      // 2. Touch Move to 40px
      const touchMoveEvent = new TouchEvent('touchmove', {
        touches: [{ clientX: 40 }] as any,
      });
      Object.defineProperty(touchMoveEvent, 'target', {
        value: progressBarEl.element,
        writable: true,
      });
      window.dispatchEvent(touchMoveEvent);
      await nextTick();
      expect((wrapper.vm as any).localPreviewTime).toBe(40);

      // 3. Touch End
      const touchEndEvent = new TouchEvent('touchend');
      window.dispatchEvent(touchEndEvent);
      await nextTick();

      const seekEvents = wrapper.emitted('seek');
      expect(seekEvents).toBeTruthy();
      expect(seekEvents![0]).toEqual([40]);
    });

    it('should draw heatmap when data provided', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 50, duration: 100 },
      });

      // Mock canvas context
      const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
      const mockContext = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillStyle: '',
      };
      vi.spyOn(canvas, 'getContext').mockReturnValue(mockContext as any);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        width: 100,
        height: 10,
      } as any);

      // Update props to trigger watch
      await wrapper.setProps({
        heatmap: { points: 10, motion: [1, 2, 3], audio: [1, 2, 3] } as any,
      });

      // Manually trigger
      (wrapper.vm as any).drawHeatmap();

      expect(mockContext.clearRect).toHaveBeenCalled();
      expect(mockContext.fillRect).toHaveBeenCalled();
      expect(mockContext.createLinearGradient).toHaveBeenCalled();
    });

    it('should handle keyboard navigation', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 10, duration: 100 },
      });
      const progressBarEl = wrapper.find('.progress-container');

      // ArrowRight
      await progressBarEl.trigger('keydown', { key: 'ArrowRight' });
      const seekEvents = wrapper.emitted('seek');
      expect(seekEvents?.[0]).toEqual([15]); // 10 + 5

      // ArrowLeft
      await progressBarEl.trigger('keydown', { key: 'ArrowLeft' });
      expect(seekEvents?.[1]).toEqual([5]); // 10 - 5
    });

    it('should draw watched segments and buffered ranges', async () => {
      const wrapper = mount(ProgressBar, {
        props: {
          currentTime: 50,
          duration: 100,
          buffered: 80,
          watchedSegments: [{ start: 0, end: 20 }],
        },
      });

      const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
      const mockContext = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillStyle: '',
      };
      vi.spyOn(canvas, 'getContext').mockReturnValue(mockContext as any);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        width: 100,
        height: 10,
      } as any);

      (wrapper.vm as any).drawHeatmap();

      // Check buffered rect calls
      expect(mockContext.rect).toHaveBeenCalled();
      // Check watched segments fillRect calls
      // It draws buffered rect, played rect, and watched segments
      expect(mockContext.fillRect).toHaveBeenCalled();
    });

    it('should fallback to audio-only or simple line if data missing', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 50, duration: 100 },
      });
      const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
      const mockContext = {
        clearRect: vi.fn(),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        beginPath: vi.fn(),
        rect: vi.fn(),
        clip: vi.fn(),
        createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
        fillStyle: '',
      };
      vi.spyOn(canvas, 'getContext').mockReturnValue(mockContext as any);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        width: 100,
        height: 10,
      } as any);

      // Case 1: Audio only
      await wrapper.setProps({
        heatmap: { points: 10, audio: [1, 2, 3] } as any, // Missing motion
      });
      (wrapper.vm as any).drawHeatmap();
      expect(mockContext.fillRect).toHaveBeenCalled();

      // Case 2: No data
      await wrapper.setProps({ heatmap: null });
      (wrapper.vm as any).drawHeatmap();
      expect(mockContext.fillRect).toHaveBeenCalled();
    });

    it('should handle zero dimensions or missing context gracefully', async () => {
      const wrapper = mount(ProgressBar, {
        props: { currentTime: 0, duration: 100 },
      });
      const canvas = wrapper.find('canvas').element as HTMLCanvasElement;

      // Case 1: Missing context
      vi.spyOn(canvas, 'getContext').mockReturnValue(null);
      (wrapper.vm as any).drawHeatmap();
      // Should return early, no errors

      // Case 2: Zero dimensions
      const mockContext = { clearRect: vi.fn() };
      vi.spyOn(canvas, 'getContext').mockReturnValue(mockContext as any);
      vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        width: 0,
        height: 0,
      } as any);

      (wrapper.vm as any).drawHeatmap();
      expect(mockContext.clearRect).not.toHaveBeenCalled();
    });
  });
});
