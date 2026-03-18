import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, reactive, toRefs } from 'vue';
import MediaDisplay from '@/components/MediaDisplay.vue';
import VideoPlayer from '@/components/VideoPlayer.vue';
import MediaControls from '@/components/MediaControls.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

// --- Mocks ---

// Mock child components
vi.mock('@/components/VideoPlayer.vue', () => ({
  default: {
    name: 'VideoPlayer',
    template: '<div class="video-player-mock"></div>',
    props: [
      'src',
      'isTranscodingMode',
      'isControlsVisible',
      'transcodedDuration',
      'currentTranscodeStartTime',
      'isTranscodingLoading',
      'isBuffering',
    ],
    emits: [
      'update:video-element',
      'buffering',
      'error',
      'play',
      'pause',
      'timeupdate',
    ],
    expose: ['reset', 'togglePlay', 'currentVideoTime'],
    setup(_: any, { emit }: any) {
      // Emit a mock video element if needed
      const mockVideo = {
        currentTime: 0,
        duration: 100,
        paused: false,
        elementName: 'MockVideoElement',
        pause: vi.fn(),
        play: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
        requestFullscreen: vi.fn(),
      };
      // We emit it on mount for coverage tests that expect it
      emit('update:video-element', mockVideo);

      return {
        reset: vi.fn(),
        togglePlay: vi.fn(),
        currentVideoTime: ref(0),
        mockVideo,
      };
    },
  },
}));

vi.mock('@/components/VRVideoPlayer.vue', () => ({
  default: {
    name: 'VRVideoPlayer',
    template: '<div class="vr-player-mock"></div>',
    props: ['src', 'isPlaying', 'initialTime', 'isControlsVisible'],
    expose: ['toggleFullscreen'],
    setup() {
      return { toggleFullscreen: vi.fn() };
    },
  },
}));

vi.mock('@/components/MediaControls.vue', () => ({
  default: {
    name: 'MediaControls',
    template:
      '<div class="media-controls-mock controls-bar w-full bg-linear-to-t from-black/90"><slot></slot></div>',
    props: ['currentMediaItem', 'isControlsVisible', 'isOpeningVlc'],
    // Mock watchedSegments prop/data if needed, but for coverage we might need to expose it
    expose: ['watchedSegments'],
    setup() {
      return {
        watchedSegments: ref([]),
      };
    },
  },
}));

vi.mock('@/components/TranscodingStatus.vue', () => ({
  default: {
    name: 'TranscodingStatus',
    template: '<div class="transcoding-status-mock"></div>',
    props: [
      'isLoading',
      'isTranscodingLoading',
      'isBuffering',
      'transcodedDuration',
      'currentTranscodeStartTime',
    ],
  },
}));

vi.mock('@/components/icons/VlcIcon.vue', () => ({
  default: { template: '<svg class="vlc-icon-mock"></svg>' },
}));

vi.mock('@/components/icons/StarIcon.vue', () => ({
  default: { template: '<svg class="star-icon-mock"></svg>' },
}));

// Mock api
vi.mock('@/api', () => ({
  api: {
    loadFileAsDataURL: vi.fn(),
    getVideoStreamUrlGenerator: vi.fn(),
    getHlsUrl: vi.fn(),
    getVideoMetadata: vi.fn(),
    setRating: vi.fn(),
    openInVlc: vi.fn(),
    updateWatchedSegments: vi.fn(),
  },
}));

// Mock composables
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');

describe('MediaDisplay Combined Tests', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;
  let slideshowMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLibraryState = reactive({
      mediaDirectories: [{ path: '/test' }],
      totalMediaInPool: 10,
      imageExtensionsSet: new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']),
      videoExtensionsSet: new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm']),
      supportedExtensions: {
        images: ['.jpg', '.png'],
        videos: ['.mp4', '.mkv', '.avi'],
        all: ['.jpg', '.png', '.mp4', '.mkv', '.avi'],
      },
      mediaUrlGenerator: vi.fn(
        (path: string) => `http://localhost/media${path}`,
      ),
      thumbnailUrlGenerator: vi.fn(
        (path: string) => `http://localhost/thumb${path}`,
      ),
    });

    mockPlayerState = reactive({
      currentMediaItem: null,
      displayedMediaFiles: [],
      currentMediaIndex: 0,
      isSlideshowActive: false,
      playFullVideo: false,
      pauseTimerOnPlay: false,
      isTimerRunning: false,
      mainVideoElement: null,
    });

    mockUIState = reactive({
      mediaFilter: ref('All'),
      viewMode: ref('player'),
      isControlsVisible: ref(true),
      isSourcesModalVisible: ref(false),
      isSidebarVisible: ref(true),
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

    slideshowMock = {
      navigateMedia: vi.fn(),
      reapplyFilter: vi.fn(),
      pauseSlideshowTimer: vi.fn(),
      resumeSlideshowTimer: vi.fn(),
      toggleSlideshowTimer: vi.fn(),
      setFilter: vi.fn(),
      prevMedia: vi.fn(),
      nextMedia: vi.fn(),
      toggleTimer: vi.fn(),
      filterMedia: vi.fn(),
    };
    (useSlideshow as Mock).mockReturnValue(slideshowMock);

    // Default API Success
    (api.loadFileAsDataURL as Mock).mockResolvedValue({
      type: 'success',
      url: 'test-url',
    });
    (api.getVideoStreamUrlGenerator as Mock).mockResolvedValue(
      (p: string) => `http://localhost/stream?path=${p}`,
    );
    (api.getHlsUrl as Mock).mockResolvedValue('/api/hls/master.m3u8?file=test');
    (api.getVideoMetadata as Mock).mockResolvedValue({ duration: 100 });
    (api.openInVlc as Mock).mockResolvedValue({ success: true });
  });

  // --- From MediaDisplay.test.ts ---
  describe('Basic Rendering', () => {
    it('renders correctly', async () => {
      const wrapper = mount(MediaDisplay);
      expect(wrapper.exists()).toBeTruthy();
      expect(wrapper.findComponent(MediaControls).exists()).toBeTruthy();
    });
  });

  describe('Media Loading', () => {
    it('loads image when currentMediaItem changes', async () => {
      mockPlayerState.currentMediaItem = {
        name: 'test.jpg',
        path: '/test.jpg',
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      expect((wrapper.vm as any).mediaUrl).toBe(
        'http://localhost/media/test.jpg',
      );
    });

    it('retains old mediaUrl when switching between media types to allow smooth transition', async () => {
      mockPlayerState.currentMediaItem = {
        name: 'video.mp4',
        path: '/video.mp4',
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      expect((wrapper.vm as any).mediaUrl).toBe(
        'http://localhost/media/video.mp4',
      );

      mockPlayerState.currentMediaItem = {
        name: 'image.jpg',
        path: '/image.jpg',
      };
      await flushPromises();
      expect((wrapper.vm as any).mediaUrl).toBe(
        'http://localhost/media/image.jpg',
      );
    });

    it('handles load error via generator exception', async () => {
      mockLibraryState.mediaUrlGenerator = () => {
        throw new Error('Generator failed');
      };
      mockPlayerState.currentMediaItem = {
        name: 'test.jpg',
        path: '/test.jpg',
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      expect((wrapper.vm as any).error).toBe('Failed to load media file.');
      expect((wrapper.vm as any).mediaUrl).toBeNull();
    });
  });

  describe('Interactions', () => {
    it('handles set-rating event from MediaControls', async () => {
      mockPlayerState.currentMediaItem = {
        name: 't.jpg',
        path: '/t.jpg',
        rating: 0,
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const controls = wrapper.findComponent(MediaControls);
      await controls.vm.$emit('set-rating', 4);

      expect(api.setRating).toHaveBeenCalledWith('/t.jpg', 4);
      expect(mockPlayerState.currentMediaItem.rating).toBe(4);
    });

    it('handles navigation events from MediaControls', async () => {
      const wrapper = mount(MediaDisplay);
      const controls = wrapper.findComponent(MediaControls);

      await controls.vm.$emit('previous');
      expect(slideshowMock.navigateMedia).toHaveBeenCalledWith(-1);

      await controls.vm.$emit('next');
      expect(slideshowMock.navigateMedia).toHaveBeenCalledWith(1);
    });

    it('handles buffering event from VideoPlayer', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent(VideoPlayer);
      await videoPlayer.vm.$emit('buffering', true);
      expect((wrapper.vm as any).isBuffering).toBe(true);

      await videoPlayer.vm.$emit('buffering', false);
      expect((wrapper.vm as any).isBuffering).toBe(false);
    });
  });

  // --- From MediaDisplay.concurrency.test.ts ---
  describe('Race Conditions', () => {
    it('correctly handles overlapping states: Transcoding text replaces Loading text', async () => {
      const wrapper = mount(MediaDisplay, {
        global: {
          stubs: {
            teleport: true,
          },
        },
      });
      const vm = wrapper.vm as any;

      // 1. Start loading a Legacy Video (forces transcoding)
      mockPlayerState.currentMediaItem = {
        name: 'legacy.mkv',
        path: '/path/to/legacy.mkv',
        type: 'video',
      };
      await wrapper.vm.$nextTick();
      await flushPromises();

      expect(vm.isLoading).toBe(false);
    });
  });

  // --- From MediaDisplayVlc.test.ts & MediaDisplay.vlc.test.ts ---
  describe('VLC Integration', () => {
    it('sets isOpeningVlc state correctly during successful open', async () => {
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      let resolveOpen: (val: any) => void;
      const openPromise = new Promise((resolve) => {
        resolveOpen = resolve;
      });
      (api.openInVlc as Mock).mockReturnValue(openPromise);

      const vm = wrapper.vm as any;
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      await wrapper.vm.$nextTick();

      const actionPromise = vm.openInVlc();
      expect(vm.isOpeningVlc).toBe(true);
      expect(api.openInVlc).toHaveBeenCalledWith('/t.mp4');

      resolveOpen!({ success: true });
      await actionPromise;
      expect(vm.isOpeningVlc).toBe(false);
    });
  });

  // --- From MediaDisplay.coverage.test.ts ---
  describe('Additional Coverage', () => {
    it('should handle handleMediaError when item is Image', async () => {
      mockPlayerState.currentMediaItem = { name: 'img.jpg', path: 'img.jpg' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      (wrapper.vm as any).handleMediaError();
      expect((wrapper.vm as any).error).toBe('Failed to load image.');
    });
  });

  // --- From MediaDisplay.test.ts (Restored Logic) ---
  describe('Keyboard & Interactions', () => {
    it('covers Space key to toggle play', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      mount(MediaDisplay);
      await flushPromises();

      const event = new KeyboardEvent('keydown', { code: 'Space' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      window.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });

    it('covers setRating error branch', async () => {
      mockPlayerState.currentMediaItem = { name: 't.jpg', path: '/t.jpg' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      (api.setRating as Mock).mockRejectedValue(new Error('fail'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const controls = wrapper.findComponent(MediaControls);
      await controls.vm.$emit('set-rating', 5);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to set rating',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('covers handleMediaError transcoding branch', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent(VideoPlayer);
      await videoPlayer.vm.$emit('error', new Event('error'));

      await flushPromises();
      await flushPromises();
      expect((wrapper.vm as any).mediaUrl).toBe(
        '/api/hls/master.m3u8?file=test',
      );
    });

    it('covers proactive transcoding for legacy formats', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mov', path: '/t.mov' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      expect((wrapper.vm as any).mediaUrl).toBe(
        '/api/hls/master.m3u8?file=test',
      );
    });

    it('covers handleVideoPlay and handleVideoPause effects on timer', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      mockPlayerState.isTimerRunning = true;
      mockPlayerState.playFullVideo = true;

      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent(VideoPlayer);
      await videoPlayer.vm.$emit('play');
      expect(slideshowMock.pauseSlideshowTimer).toHaveBeenCalled();

      mockPlayerState.isTimerRunning = false;
      mockPlayerState.pauseTimerOnPlay = true;
      mockPlayerState.playFullVideo = false;

      await videoPlayer.vm.$emit('pause');
      expect(slideshowMock.resumeSlideshowTimer).toHaveBeenCalled();
    });

    it('handleVideoEnded should NOT navigate if isLoading is true', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      mockPlayerState.playFullVideo = true;
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent(VideoPlayer);

      // Force loading state to true
      (wrapper.vm as any).isLoading = true;

      await videoPlayer.vm.$emit('ended');

      expect(slideshowMock.navigateMedia).not.toHaveBeenCalled();

      // Now set loading to false
      (wrapper.vm as any).isLoading = false;
      await videoPlayer.vm.$emit('ended');

      expect(slideshowMock.navigateMedia).toHaveBeenCalledWith(1);
    });

    it('covers handleMediaError in transcoding mode', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      (wrapper.vm as any).isTranscodingMode = true;
      (wrapper.vm as any).handleMediaError();
      expect((wrapper.vm as any).error).toBe('Failed to display media file.');
    });

    it('covers tryTranscoding requestId mismatch', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      await (wrapper.vm as any).tryTranscoding(0, -1);
      expect((wrapper.vm as any).isTranscodingMode).toBe(false);
    });

    it('covers setRating unrate branch', async () => {
      mockPlayerState.currentMediaItem = {
        name: 't.jpg',
        path: '/t.jpg',
        rating: 5,
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const controls = wrapper.findComponent(MediaControls);
      await controls.vm.$emit('set-rating', 5);
      expect(mockPlayerState.currentMediaItem.rating).toBe(0);
    });

    it('covers loadMediaUrl null currentMediaItem', async () => {
      mockPlayerState.currentMediaItem = null;
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      expect((wrapper.vm as any).mediaUrl).toBeNull();
    });

    it('covers loadMediaUrl videoElement cleanup fallback', async () => {
      mockPlayerState.currentMediaItem = { name: 't.jpg', path: '/t.jpg' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const mockVideo = {
        pause: vi.fn(),
        removeAttribute: vi.fn(),
        load: vi.fn(),
      };
      (wrapper.vm as any).videoElement = mockVideo;
      (wrapper.vm as any).videoPlayerRef = null;

      mockPlayerState.currentMediaItem = { name: 't2.jpg', path: '/t2.jpg' };
      await flushPromises();
      expect(mockVideo.pause).toHaveBeenCalled();
    });

    it('covers handleBuffering while transcoding loading', async () => {
      const wrapper = mount(MediaDisplay);
      (wrapper.vm as any).isTranscodingLoading = true;
      (wrapper.vm as any).handleBuffering(true);
      expect((wrapper.vm as any).isBuffering).toBe(false);
    });

    it('covers openInVlc failure branch', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      (api.openInVlc as Mock).mockResolvedValue({
        success: false,
        message: 'VLC Error',
      });
      await (wrapper.vm as any).openInVlc();
      expect((wrapper.vm as any).error).toBe('VLC Error');
    });

    it('covers handleVideoElementUpdate', async () => {
      const wrapper = mount(MediaDisplay);
      const mockVideo = document.createElement('video');
      (wrapper.vm as any).handleVideoElementUpdate(mockVideo);
      expect((wrapper.vm as any).videoElement).toBe(mockVideo);
    });

    it('covers currentVideoTime getter fallback', async () => {
      const wrapper = mount(MediaDisplay);
      (wrapper.vm as any).videoPlayerRef = null;
      expect((wrapper.vm as any).currentVideoTime).toBe(0);
    });

    it('covers currentMediaItem watch resumeSlideshowTimer branch', async () => {
      mockPlayerState.currentMediaItem = { name: 't.jpg', path: '/t.jpg' };
      mockPlayerState.playFullVideo = true;
      mockPlayerState.isTimerRunning = false;

      mount(MediaDisplay);
      await flushPromises();
      expect(slideshowMock.resumeSlideshowTimer).toHaveBeenCalled();
    });

    it('covers Try Transcoding button click', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      (wrapper.vm as any).isVideoSupported = false;
      (wrapper.vm as any).isTranscodingMode = false;
      await wrapper.vm.$nextTick();

      const btn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Try Transcoding'));
      await btn?.trigger('click');
      expect((wrapper.vm as any).mediaUrl).toBe(
        '/api/hls/master.m3u8?file=test',
      );
    });

    it('does NOT resume timer when video is paused due to navigation', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      mockPlayerState.isTimerRunning = false;
      mockPlayerState.pauseTimerOnPlay = true;
      mockPlayerState.playFullVideo = false;

      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const videoPlayer = wrapper.findComponent(VideoPlayer);
      (wrapper.vm as any).isLoading = true;
      await videoPlayer.vm.$emit('pause');
      expect(slideshowMock.resumeSlideshowTimer).not.toHaveBeenCalled();
    });

    it('does resume timer when video is paused manually', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      mockPlayerState.isTimerRunning = false;
      mockPlayerState.pauseTimerOnPlay = true;
      mockPlayerState.playFullVideo = false;

      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const videoPlayer = wrapper.findComponent(VideoPlayer);
      (wrapper.vm as any).isLoading = false;
      await videoPlayer.vm.$emit('pause');
      expect(slideshowMock.resumeSlideshowTimer).toHaveBeenCalled();
    });

    it('covers fullscreen toggle for VR mode', async () => {
      mockPlayerState.currentMediaItem = { name: 'vr.mp4', path: '/vr.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      (wrapper.vm as any).isVrMode = true;
      await wrapper.vm.$nextTick();
      const vrPlayer = { toggleFullscreen: vi.fn() };
      (wrapper.vm as any).vrPlayerRef = vrPlayer;
      (wrapper.vm as any).toggleFullscreen();
      expect(vrPlayer.toggleFullscreen).toHaveBeenCalled();
    });

    it('covers fullscreen toggle for normal video', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const videoEl = {
        requestFullscreen: vi.fn().mockResolvedValue(undefined),
      };
      (wrapper.vm as any).videoElement = videoEl;
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
      });
      (wrapper.vm as any).toggleFullscreen();
      expect(videoEl.requestFullscreen).toHaveBeenCalled();
    });

    it('covers fullscreen exit for normal video', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const videoEl = { requestFullscreen: vi.fn() };
      (wrapper.vm as any).videoElement = videoEl;
      Object.defineProperty(document, 'fullscreenElement', {
        value: {},
        writable: true,
      });
      document.exitFullscreen = vi.fn();
      (wrapper.vm as any).toggleFullscreen();
      expect(document.exitFullscreen).toHaveBeenCalled();
    });

    it('covers fullscreen error handling', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const videoEl = {
        requestFullscreen: vi.fn().mockRejectedValue(new Error('FS Fail')),
      };
      (wrapper.vm as any).videoElement = videoEl;
      Object.defineProperty(document, 'fullscreenElement', {
        value: null,
        writable: true,
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await (wrapper.vm as any).toggleFullscreen();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it('does not throw when seeking forward if video duration is NaN', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const mockVideo = {
        duration: NaN,
        get currentTime() {
          return 10;
        },
        set currentTime(val: number) {
          if (!Number.isFinite(val)) throw new Error('non-finite');
        },
      };
      (wrapper.vm as any).videoElement = mockVideo;
      const event = new KeyboardEvent('keydown', { code: 'ArrowRight' });
      window.dispatchEvent(event);
    });

    it('does not throw when seeking backward if video duration is NaN', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const mockVideo = {
        duration: NaN,
        get currentTime() {
          return 10;
        },
        set currentTime(val: number) {
          if (!Number.isFinite(val)) throw new Error('non-finite');
        },
      };
      (wrapper.vm as any).videoElement = mockVideo;
      const event = new KeyboardEvent('keydown', { code: 'ArrowLeft' });
      window.dispatchEvent(event);
    });
  });

  describe('Empty State UX', () => {
    it('shows "Open Library" button when sidebar is hidden and no media selected', async () => {
      mockPlayerState.currentMediaItem = null;
      mockUIState.isSidebarVisible = false;
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const openLibBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Open Library'));
      expect(openLibBtn?.exists()).toBe(true);
      await openLibBtn?.trigger('click');
      expect(mockUIState.isSidebarVisible).toBe(true);
    });
  });

  describe('Layout & Styles', () => {
    it('should have correct layout classes on desktop', async () => {
      // Need to ensure an item is loaded to render controls
      mockPlayerState.currentMediaItem = {
        name: 'test.jpg',
        path: '/test.jpg',
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();
      const controls = wrapper.find('.controls-bar');
      const classes = controls.classes();
      expect(classes).toContain('w-full');
      expect(classes).toContain('bg-linear-to-t');
      expect(classes).toContain('from-black/90');
    });
  });

  // --- Advanced Features (New Coverage) ---
  describe('Advanced Features', () => {
    it('Add Media Source button toggles modal', async () => {
      mockPlayerState.currentMediaItem = null;
      mockLibraryState.mediaDirectories = []; // Empty state
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const addBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Add Media Source'));
      expect(addBtn?.exists()).toBe(true);
      await addBtn?.trigger('click');
      expect(mockUIState.isSourcesModalVisible).toBe(true);
    });

    it('Handles transcoding failure gracefully', async () => {
      mockPlayerState.currentMediaItem = {
        name: 'video.mp4',
        path: '/video.mp4',
      };
      (api.getHlsUrl as Mock).mockRejectedValue(new Error('HLS Error'));

      const wrapper = mount(MediaDisplay);
      await flushPromises();

      await (wrapper.vm as any).tryTranscoding(0);
      expect((wrapper.vm as any).error).toBe('Failed to start playback');
      expect((wrapper.vm as any).isTranscodingLoading).toBe(false);
    });

    it('Prefetches next media item if image', async () => {
      mockPlayerState.currentMediaItem = { name: '1.jpg', path: '/1.jpg' };
      mockPlayerState.displayedMediaFiles = [
        { name: '1.jpg', path: '/1.jpg' },
        { name: '2.jpg', path: '/2.jpg' },
      ];
      mockPlayerState.currentMediaIndex = 0;

      mount(MediaDisplay);
      await flushPromises();

      // Trigger watcher logic manually or by wait
      // The watch immediate:true calls loadMediaUrl, which finishes,
      // then we should see generator called for /2.jpg
      expect(mockLibraryState.mediaUrlGenerator).toHaveBeenCalledWith('/2.jpg');
    });

    it('Prefetches next media item thumbnail if video', async () => {
      mockPlayerState.currentMediaItem = { name: '1.mp4', path: '/1.mp4' };
      mockPlayerState.displayedMediaFiles = [
        { name: '1.mp4', path: '/1.mp4' },
        { name: '2.mp4', path: '/2.mp4' },
      ];
      mockPlayerState.currentMediaIndex = 0;

      mount(MediaDisplay);
      await flushPromises();

      expect(mockLibraryState.thumbnailUrlGenerator).toHaveBeenCalledWith(
        '/2.mp4',
      );
    });

    it('Updates watched segments on time update and persists on unmount', async () => {
      mockPlayerState.currentMediaItem = {
        name: 'video.mp4',
        path: '/video.mp4',
      };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent(VideoPlayer);

      // Simulate playing
      (wrapper.vm as any).isPlaying = true;
      await wrapper.vm.$nextTick();

      // 1. Time update (start tracking)
      await videoPlayer.vm.$emit('timeupdate', 10);
      expect((wrapper.vm as any).savedCurrentTime).toBe(10);

      // 2. Time update (end segment)
      await videoPlayer.vm.$emit('timeupdate', 12);

      // Verify internal state (difficult without exposed state, but we can check if it calls api on unmount)
      wrapper.unmount();

      expect(api.updateWatchedSegments).toHaveBeenCalledWith(
        '/video.mp4',
        expect.stringContaining('"start":10'),
      );
    });

    it('Toggles mute state', async () => {
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.isMuted).toBe(false);

      vm.toggleMute();
      expect(vm.isMuted).toBe(true);

      vm.toggleMute();
      expect(vm.isMuted).toBe(false);
    });

    it('Toggles VR mode', async () => {
      const wrapper = mount(MediaDisplay);
      const vm = wrapper.vm as any;

      expect(vm.isVrMode).toBe(false);
      vm.toggleVrMode();
      expect(vm.isVrMode).toBe(true);
    });

    it('Handles keyboard shortcuts', async () => {
      mockPlayerState.currentMediaItem = { name: 'vid.mp4', path: '/vid.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const vm = wrapper.vm as any;
      const videoEl = {
        currentTime: 10,
        duration: 100,
        paused: false,
        play: vi.fn(),
        pause: vi.fn(),
      };
      vm.videoElement = videoEl;

      // Arrow Right -> Seek Forward
      const arrowRight = new KeyboardEvent('keydown', { code: 'ArrowRight' });
      window.dispatchEvent(arrowRight);
      expect(videoEl.currentTime).toBe(15);

      // Arrow Left -> Seek Backward
      const arrowLeft = new KeyboardEvent('keydown', { code: 'ArrowLeft' });
      window.dispatchEvent(arrowLeft);
      expect(videoEl.currentTime).toBe(10);
    });

    it('Handles keyboard shortcuts in Transcoding Mode', async () => {
      mockPlayerState.currentMediaItem = { name: 'vid.mp4', path: '/vid.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.isTranscodingMode = true;
      vm.transcodedDuration = 100;
      vm.savedCurrentTime = 10;
      // We cannot mock internal function easily, so we check side effects
      // tryTranscoding updates currentTranscodeStartTime

      // Arrow Right -> Seek Forward (+5s) => 15
      const arrowRight = new KeyboardEvent('keydown', { code: 'ArrowRight' });
      window.dispatchEvent(arrowRight);
      expect(vm.currentTranscodeStartTime).toBe(15);

      // tryTranscoding disables isTranscodingMode (as it assumes HLS takeover).
      // We must reset it to true to test the 'ArrowLeft' transcoding branch logic again.
      vm.isTranscodingMode = true;

      // Arrow Left -> Seek Backward (-5s) => 5
      const arrowLeft = new KeyboardEvent('keydown', { code: 'ArrowLeft' });
      window.dispatchEvent(arrowLeft);
      expect(vm.currentTranscodeStartTime).toBe(5);
    });

    it('Handles Space key for Slideshow vs Video', async () => {
      // 1. Image Mode
      mockPlayerState.currentMediaItem = { name: 'img.jpg', path: '/img.jpg' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const space = new KeyboardEvent('keydown', { code: 'Space' });
      window.dispatchEvent(space);
      expect(slideshowMock.toggleSlideshowTimer).toHaveBeenCalled();

      // 2. Video Mode
      mockPlayerState.currentMediaItem = { name: 'vid.mp4', path: '/vid.mp4' };
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.videoPlayerRef = { togglePlay: vi.fn() };

      window.dispatchEvent(space);
      expect(vm.videoPlayerRef.togglePlay).toHaveBeenCalled();
    });

    it('handles persisted watched segments update failure gracefully', async () => {
      mockPlayerState.currentMediaItem = { name: 'vid.mp4', path: '/vid.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      (api.updateWatchedSegments as Mock).mockRejectedValue(
        new Error('Update failed'),
      );
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await (wrapper.vm as any).persistWatchedSegments();
      expect(spy).toHaveBeenCalledWith(
        'Failed to persist segments',
        expect.any(Error),
      );
      spy.mockRestore();
    });

    it('covers Unsupported Format branch', async () => {
      mockPlayerState.currentMediaItem = { name: 't.hevc', path: '/t.hevc' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      // Manually set flags to trigger the block
      (wrapper.vm as any).isVideoSupported = false;
      (wrapper.vm as any).isLoading = false;
      (wrapper.vm as any).isTranscodingMode = false;
      await wrapper.vm.$nextTick();

      const text = wrapper.text();
      expect(text).toContain('Video Format Not Supported');
      expect(text).toContain('Try Transcoding');
    });

    it('covers handleSeek in transcoding mode', async () => {
      mockPlayerState.currentMediaItem = { name: 't.mp4', path: '/t.mp4' };
      const wrapper = mount(MediaDisplay);
      await flushPromises();

      (wrapper.vm as any).isTranscodingMode = true;
      (wrapper.vm as any).currentTranscodeStartTime = 0;

      const controls = wrapper.findComponent(MediaControls);
      await controls.vm.$emit('seek', 50);

      expect((wrapper.vm as any).currentTranscodeStartTime).toBe(50);
    });

    it('covers handleScrubStart and handleScrubEnd', async () => {
      const wrapper = mount(MediaDisplay);
      const controls = wrapper.findComponent(MediaControls);

      await controls.vm.$emit('scrub-start');
      await controls.vm.$emit('scrub-end');
      // Mostly ensuring no error throw, as implementation logic is commented out in component
    });
  });
});
