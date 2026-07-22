import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaDisplay from '@/features/player/MediaDisplay.vue';
import MediaControls from '@/features/player/MediaControls.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useTranscoder } from '@/composables/useTranscoder';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

vi.mock('@/features/player/VideoPlayer.vue', () => ({
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
      'ended',
    ],
    expose: ['reset', 'togglePlay', 'currentVideoTime'],
    setup(_: any, { emit }: any) {
      const mockVideo = {
        currentTime: 0,
        duration: 100,
        paused: false,
        pause: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
        load: vi.fn(),
        requestFullscreen: vi.fn(),
      };
      emit('update:video-element', mockVideo);
      return { reset: vi.fn(), togglePlay: vi.fn(), currentVideoTime: ref(0) };
    },
  },
}));

vi.mock('@/api');

// Keep non-Pinia composables mocked
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useMediaLoader');
vi.mock('@/composables/useTranscoder');

describe('MediaDisplay Combined Tests', () => {
  let mockSlideshow: any;
  let mockMediaLoader: any;
  let mockTranscoder: any;

  beforeEach(() => {
    vi.clearAllMocks();

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    // Set Pinia store state
    useLibraryStore().supportedExtensions = {
      images: ['.jpg', '.png'],
      videos: ['.mp4'],
      all: ['.jpg', '.png', '.mp4'],
    };
    useLibraryStore().mediaUrlGenerator = ((path: string) =>
      `media://${path}`) as any;
    useLibraryStore().mediaDirectories = [];

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().mainVideoElement = null;
    usePlayerStore().pauseTimerOnPlay = false;

    usePlaylistStore().currentItem = null;
    usePlaylistStore().history = [];
    usePlaylistStore().queue = [];

    useUIStore().mediaFilter = 'All';
    useUIStore().viewMode = 'player';
    useUIStore().isControlsVisible = true;
    useUIStore().isSidebarVisible = true;
    useUIStore().isSourcesModalVisible = false;

    mockMediaLoader = {
      mediaUrl: ref(null),
      isLoading: ref(false),
      error: ref(null),
      isVideoSupported: ref(true),
      loadMedia: vi.fn(),
    };
    (useMediaLoader as Mock).mockReturnValue(mockMediaLoader);

    mockTranscoder = {
      isTranscodingMode: ref(false),
      isTranscodingLoading: ref(false),
      transcodingProgress: ref(0),
      transcodedDuration: ref(0),
      startTranscoding: vi.fn(),
      resetTranscoderState: vi.fn(),
    };
    (useTranscoder as Mock).mockReturnValue(mockTranscoder);

    mockSlideshow = {
      navigateMedia: vi.fn(),
      resumeSlideshowTimer: vi.fn(),
      pauseSlideshowTimer: vi.fn(),
    };
    (useSlideshow as Mock).mockReturnValue(mockSlideshow);
  });

  it('renders correctly', async () => {
    const wrapper = mount(MediaDisplay);
    expect(wrapper.exists()).toBeTruthy();
  });

  it('loads media when currentItem changes', async () => {
    mount(MediaDisplay);
    usePlaylistStore().currentItem = { path: '/test.jpg' } as any;
    await flushPromises();
    expect(mockMediaLoader.loadMedia).toHaveBeenCalled();
  });

  it('updates rating', async () => {
    usePlaylistStore().currentItem = { path: '/test.jpg', rating: 0 } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    const controls = wrapper.findComponent(MediaControls);
    await controls.vm.$emit('set-rating', 4);
    expect(api.setRating).toHaveBeenCalledWith('/test.jpg', 4);
  });

  it('handles navigation', async () => {
    const wrapper = mount(MediaDisplay);
    const controls = wrapper.findComponent(MediaControls);
    await controls.vm.$emit('next');
    expect(mockSlideshow.navigateMedia).toHaveBeenCalledWith(1);
  });

  it('discards a stale item change that resumes after a slow getMetadata', async () => {
    // Item A's metadata fetch resolves only after the user has already
    // switched to item B. The stale invocation must not call loadMedia —
    // doing so would bump the loader's request id and clobber B's mediaUrl.
    let resolveMetaA!: (v: Record<string, unknown>) => void;
    (api.getMetadata as Mock).mockImplementation((paths: string[]) => {
      if (paths[0] === '/a.mp4') {
        return new Promise((resolve) => (resolveMetaA = resolve));
      }
      return Promise.resolve({ [paths[0]]: { playbackPosition: 0 } });
    });

    mount(MediaDisplay);
    await flushPromises();
    mockMediaLoader.loadMedia.mockClear();

    usePlaylistStore().currentItem = { path: '/a.mp4' } as any;
    await Promise.resolve(); // let the watch start and block on getMetadata

    usePlaylistStore().currentItem = { path: '/b.mp4' } as any;
    await flushPromises();

    resolveMetaA({ '/a.mp4': { playbackPosition: 42, duration: 100 } });
    await flushPromises();

    const loadedPaths = mockMediaLoader.loadMedia.mock.calls.map(
      (call: any[]) => call[0].path,
    );
    expect(loadedPaths).toContain('/b.mp4');
    expect(loadedPaths).not.toContain('/a.mp4');
  });

  describe('Slideshow Video Handling', () => {
    it('should navigate to next slide if video ends and timer is NOT running', async () => {
      usePlayerStore().isTimerRunning = false;
      usePlaylistStore().currentItem = { path: '/test.mp4' } as any;
      mockMediaLoader.mediaUrl.value = 'media://test.mp4';
      mockMediaLoader.isLoading.value = false;

      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent({ name: 'VideoPlayer' });
      videoPlayer.vm.$emit('ended');

      expect(mockSlideshow.navigateMedia).toHaveBeenCalledWith(1);
    });

    it('should loop video if video ends and timer IS running (short video)', async () => {
      usePlayerStore().isTimerRunning = true;
      usePlaylistStore().currentItem = { path: '/test.mp4' } as any;
      mockMediaLoader.mediaUrl.value = 'media://test.mp4';
      mockMediaLoader.isLoading.value = false;

      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent({ name: 'VideoPlayer' });
      videoPlayer.vm.$emit('ended');

      // Navigate should NOT be called, instead it should loop the video (play)
      expect(mockSlideshow.navigateMedia).not.toHaveBeenCalled();
    });

    it('should pause timer if video duration is longer than timer duration and we dont pause on play automatically', async () => {
      usePlayerStore().isTimerRunning = true;
      usePlayerStore().pauseTimerOnPlay = false;
      usePlayerStore().timerDuration = 5;
      usePlaylistStore().currentItem = { path: '/test.mp4' } as any;
      mockMediaLoader.mediaUrl.value = 'media://test.mp4';
      mockMediaLoader.isLoading.value = false;

      const wrapper = mount(MediaDisplay);
      await flushPromises();

      const videoPlayer = wrapper.findComponent({ name: 'VideoPlayer' });

      // In the mock, duration is 100, which is > 5
      videoPlayer.vm.$emit('loadedmetadata');

      expect(mockSlideshow.pauseSlideshowTimer).toHaveBeenCalled();
    });
  });
});
