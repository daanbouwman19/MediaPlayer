import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaDisplay from '@/components/MediaDisplay.vue';
import MediaControls from '@/components/MediaControls.vue';
import VideoPlayer from '@/components/VideoPlayer.vue';
import VRVideoPlayer from '@/components/VRVideoPlayer.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useTranscoder } from '@/composables/useTranscoder';
import { useUIStore } from '@/composables/useUIStore';
import { useToast } from '@/composables/useToast';
import { api } from '@/api';

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
      'playing',
      'timeupdate',
      'ended',
      'trigger-transcode',
    ],
    setup(_: any, { emit }: any) {
      const mockVideo = {
        currentTime: 0,
        duration: 100,
        paused: false,
        pause: vi.fn(),
        play: vi.fn(),
        load: vi.fn(),
        requestFullscreen: vi.fn().mockResolvedValue(undefined),
        removeAttribute: vi.fn(),
      };
      emit('update:video-element', mockVideo);
      return {
        reset: vi.fn(),
        togglePlay: vi.fn(),
        currentVideoTime: ref(0),
      };
    },
  },
}));

// Note: defineAsyncComponent in MediaDisplay calls `import('./VRVideoPlayer.vue')`
// and then probes the returned module for `__esModule`, `__isTeleport`,
// `__asyncLoader`, etc. Vitest's strict mock mode throws on access to undefined
// exports, so we declare those flags explicitly alongside the stub.
vi.mock('@/components/VRVideoPlayer.vue', () => ({
  __esModule: true,
  __isTeleport: false,
  __isKeepAlive: false,
  __asyncLoader: undefined,
  __asyncResolved: undefined,
  default: {
    name: 'VRVideoPlayer',
    template: '<div class="vr-video-player-mock"></div>',
    props: ['src', 'poster', 'isPlaying', 'initialTime', 'isControlsVisible'],
    emits: ['timeupdate', 'update:video-element', 'play', 'pause'],
    setup() {
      return { toggleFullscreen: vi.fn() };
    },
  },
}));

vi.mock('@/api');
// Keep non-Pinia composables mocked
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useMediaLoader');
vi.mock('@/composables/useTranscoder');
vi.mock('@/composables/useToast');

describe('MediaDisplay Coverage Boost', () => {
  let mockSlideshow: any;
  let mockMediaLoader: any;
  let mockTranscoder: any;
  let mockToast: any;

  beforeEach(() => {
    vi.clearAllMocks();

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    // Set Pinia store state
    useLibraryStore().imageExtensionsSet = new Set(['.jpg', '.png']) as any;
    useLibraryStore().mediaDirectories = [];
    useLibraryStore().thumbnailUrlGenerator = ((path: string) => `thumb://${path}`) as any;

    usePlayerStore().pauseTimerOnPlay = false;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().mainVideoElement = null;
    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().timerDuration = 5;

    usePlaylistStore().currentItem = null;
    usePlaylistStore().queue = [];
    usePlaylistStore().history = [];

    useUIStore().isControlsVisible = true;
    useUIStore().isSourcesModalVisible = false;
    useUIStore().isSidebarVisible = true;

    mockSlideshow = {
      navigateMedia: vi.fn(),
      pauseSlideshowTimer: vi.fn(),
      resumeSlideshowTimer: vi.fn(),
      toggleSlideshowTimer: vi.fn(),
    };
    (useSlideshow as Mock).mockReturnValue(mockSlideshow);

    mockMediaLoader = {
      isLoading: ref(false),
      mediaUrl: ref(null),
      error: ref(null),
      isVideoSupported: ref(true),
      currentLoadRequestId: ref(0),
      loadMedia: vi.fn(),
    };
    (useMediaLoader as Mock).mockReturnValue(mockMediaLoader);

    mockTranscoder = {
      isTranscodingMode: ref(false),
      isTranscodingLoading: ref(false),
      isBuffering: ref(false),
      transcodedDuration: ref(0),
      transcodingProgress: ref(0),
      currentTranscodeStartTime: ref(0),
      startTranscoding: vi.fn(),
      resetTranscoderState: vi.fn(),
      stopTranscodingProgressPoll: vi.fn(),
      setBuffering: vi.fn(),
    };
    (useTranscoder as Mock).mockReturnValue(mockTranscoder);

    mockToast = {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };
    (useToast as Mock).mockReturnValue(mockToast);
  });

  it('shows welcome screen when no media directories', async () => {
    const wrapper = mount(MediaDisplay);
    expect(wrapper.text()).toContain('Welcome to Media Player');
    await wrapper.find('button.glass-button').trigger('click');
    expect(useUIStore().isSourcesModalVisible).toBe(true);
  });

  it('shows library empty screen when media directories exist but no item selected', async () => {
    useLibraryStore().mediaDirectories = ['/path'] as any;
    const wrapper = mount(MediaDisplay);
    expect(wrapper.text()).toContain('Select an album to start playback');

    useUIStore().isSidebarVisible = false;
    await flushPromises();
    expect(wrapper.text()).toContain('Open Library');
    await wrapper.find('button.glass-button').trigger('click');
    expect(useUIStore().isSidebarVisible).toBe(true);
  });

  it('shows error message', async () => {
    usePlaylistStore().currentItem = { path: 'p' } as any;
    mockMediaLoader.error.value = 'Failed to load';
    const wrapper = mount(MediaDisplay);
    expect(wrapper.text()).toContain('Failed to load');
  });

  it('shows unsupported format message', async () => {
    usePlaylistStore().currentItem = { path: 'video.hevc' } as any;
    mockMediaLoader.isVideoSupported.value = false;
    const wrapper = mount(MediaDisplay);
    expect(wrapper.text()).toContain('Video Format Not Supported');

    (api.openInVlc as Mock).mockResolvedValue({ success: true });
    await wrapper.find('button.glass-button').trigger('click');
    expect(api.openInVlc).toHaveBeenCalled();
  });

  it('handles try transcoding button', async () => {
    usePlaylistStore().currentItem = { path: 'video.hevc' } as any;
    mockMediaLoader.isVideoSupported.value = false;
    const wrapper = mount(MediaDisplay);

    mockTranscoder.startTranscoding.mockResolvedValue('transcoded-url');
    await wrapper.findAll('button.glass-button')[1].trigger('click');
    expect(mockTranscoder.startTranscoding).toHaveBeenCalled();
    expect(mockMediaLoader.mediaUrl.value).toBe('transcoded-url');
    expect(mockMediaLoader.isVideoSupported.value).toBe(true);
  });

  it('handles video player events', async () => {
    usePlaylistStore().currentItem = { path: 'video.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'video-url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const videoPlayer = wrapper.findComponent(VideoPlayer);

    // Play
    await videoPlayer.vm.$emit('play');
    expect(usePlayerStore().pauseTimerOnPlay).toBe(false); // Default is false

    // Pause
    await videoPlayer.vm.$emit('pause');

    // Ended
    await videoPlayer.vm.$emit('ended');
    expect(mockSlideshow.navigateMedia).toHaveBeenCalledWith(1);

    // Buffering
    await videoPlayer.vm.$emit('buffering', true);
    expect(mockTranscoder.setBuffering).toHaveBeenCalledWith(true);

    // Playing (clears loading)
    mockTranscoder.isTranscodingLoading.value = true;
    await videoPlayer.vm.$emit('playing');
    expect(mockTranscoder.isTranscodingLoading.value).toBe(false);

    // Time update for watched segments
    const controls = wrapper.findComponent(MediaControls);
    (controls.vm as any).watchedSegments = [];
    await videoPlayer.vm.$emit('play');
    await videoPlayer.vm.$emit('timeupdate', 10);
    await videoPlayer.vm.$emit('timeupdate', 12);
    expect((controls.vm as any).watchedSegments.length).toBeGreaterThan(0);
  });

  it('handles global keyboard shortcuts', async () => {
    usePlaylistStore().currentItem = { path: 'video.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'video-url';
    mount(MediaDisplay);
    await flushPromises();

    // Space to toggle play
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));

    // ArrowRight to seek
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));

    // ArrowLeft to seek
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));

    // ArrowRight in transcoding mode
    mockTranscoder.isTranscodingMode.value = true;
    mockTranscoder.transcodedDuration.value = 100;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    expect(mockTranscoder.startTranscoding).toHaveBeenCalled();
  });

  it('handles image slideshow', async () => {
    usePlaylistStore().currentItem = { path: 'img.jpg' } as any;
    useLibraryStore().imageExtensionsSet = new Set(['.jpg']) as any;
    mockMediaLoader.mediaUrl.value = 'img-url';

    mount(MediaDisplay);
    await flushPromises();
    expect(mockSlideshow.resumeSlideshowTimer).toHaveBeenCalled();

    // Space toggles slideshow timer for images
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(mockSlideshow.toggleSlideshowTimer).toHaveBeenCalled();
  });

  it('handles rating and mute toggles', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4', rating: 1 } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const controls = wrapper.findComponent(MediaControls);

    // Toggle Mute
    await controls.vm.$emit('toggle-mute');

    // Set Rating
    (api.setRating as Mock).mockResolvedValue({ success: true });
    await controls.vm.$emit('set-rating', 5);
    expect(api.setRating).toHaveBeenCalledWith('v.mp4', 5);
    expect(mockToast.success).toHaveBeenCalledWith('Rated 5 stars');

    // Clear Rating
    await controls.vm.$emit('set-rating', 5); // Toggle same rating
    expect(api.setRating).toHaveBeenCalledWith('v.mp4', 0);
    expect(mockToast.info).toHaveBeenCalledWith('Rating cleared');
  });

  it('handles VR mode', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const controls = wrapper.findComponent(MediaControls);
    await controls.vm.$emit('toggle-vr');
    await flushPromises();

    expect(wrapper.findComponent(VRVideoPlayer).exists()).toBe(true);

    const mockVrPlayer = { toggleFullscreen: vi.fn() };
    (wrapper.vm as any).vrPlayerRef = mockVrPlayer;
    await controls.vm.$emit('toggle-fullscreen');
    expect(mockVrPlayer.toggleFullscreen).toHaveBeenCalled();
  });

  it('handles media error and auto-transcode', async () => {
    usePlaylistStore().currentItem = { path: 'broken.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const videoPlayer = wrapper.findComponent(VideoPlayer);
    await videoPlayer.vm.$emit('error');
    expect(mockTranscoder.startTranscoding).toHaveBeenCalled();

    // Error in transcoding mode
    mockTranscoder.isTranscodingMode.value = true;
    await videoPlayer.vm.$emit('error');
    expect(mockMediaLoader.error.value).toBe('Failed to display media file.');
  });

  it('handles rating error', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4', rating: 1 } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const controls = wrapper.findComponent(MediaControls);
    (api.setRating as Mock).mockRejectedValue(new Error('Failed'));
    await controls.vm.$emit('set-rating', 5);
    expect(mockToast.error).toHaveBeenCalledWith(
      'Failed to set rating. Please try again.',
    );
  });

  it('handles navigation previous', async () => {
    const wrapper = mount(MediaDisplay);
    const controls = wrapper.findComponent(MediaControls);
    await controls.vm.$emit('previous');
    expect(mockSlideshow.navigateMedia).toHaveBeenCalledWith(-1);
  });

  it('handles fullscreen toggle with video element', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const controls = wrapper.findComponent(MediaControls);
    await controls.vm.$emit('toggle-fullscreen');

    // If we want to test document.exitFullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: {},
      configurable: true,
    });
    document.exitFullscreen = vi.fn();
    await controls.vm.$emit('toggle-fullscreen');
    expect(document.exitFullscreen).toHaveBeenCalled();

    // Reset
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
    });
  });

  it('handles tryTranscoding error', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    mockTranscoder.startTranscoding.mockRejectedValue(new Error('Fail'));

    await (wrapper.vm as any).tryTranscoding(0);
    expect(mockMediaLoader.error.value).toBe('Failed to start playback');
  });

  it('handles keyboard seek boundaries', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    mockTranscoder.isTranscodingMode.value = true;
    mockTranscoder.transcodedDuration.value = 100;

    const wrapper = mount(MediaDisplay);
    await flushPromises();

    // Near end
    (wrapper.vm as any).currentVideoTime = 98;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    expect(mockTranscoder.startTranscoding).toHaveBeenCalledWith('v.mp4', 100);

    // Near start
    (wrapper.vm as any).currentVideoTime = 2;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowLeft' }));
    expect(mockTranscoder.startTranscoding).toHaveBeenCalledWith('v.mp4', 0);
  });

  it('handles persistWatchedSegments error', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    (api.updateWatchedSegments as Mock).mockRejectedValue(new Error('Fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await (wrapper.vm as any).persistWatchedSegments();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('restores saved playback position on video load', async () => {
    useLibraryStore().imageExtensionsSet = new Set(['.jpg']) as any;
    (api.getMetadata as Mock).mockResolvedValue({
      'v.mp4': { playbackPosition: 42, duration: 100 },
    });
    usePlaylistStore().currentItem = { name: 'v.mp4', path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    expect(api.getMetadata).toHaveBeenCalledWith(['v.mp4']);
    expect((wrapper.vm as any).savedCurrentTime).toBe(42);
  });

  it('does not restore position if file is effectively finished (>=95%)', async () => {
    (api.getMetadata as Mock).mockResolvedValue({
      'v.mp4': { playbackPosition: 99, duration: 100 },
    });
    usePlaylistStore().currentItem = { name: 'v.mp4', path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    expect((wrapper.vm as any).savedCurrentTime).toBe(0);
  });

  it('skips metadata fetch for image media items', async () => {
    useLibraryStore().imageExtensionsSet = new Set(['.jpg']) as any;
    usePlaylistStore().currentItem = { name: 'photo.jpg', path: 'photo.jpg' } as any;
    mount(MediaDisplay);
    await flushPromises();
    expect(api.getMetadata).not.toHaveBeenCalled();
  });

  it('persists playback position when video is paused', async () => {
    usePlaylistStore().currentItem = { name: 'v.mp4', path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    (wrapper.vm as any).savedCurrentTime = 17;
    const videoPlayer = wrapper.findComponent(VideoPlayer);
    await videoPlayer.vm.$emit('pause');
    expect(api.updatePlaybackPosition).toHaveBeenCalledWith('v.mp4', 17);
  });

  it('persistPlaybackPosition swallows errors gracefully', async () => {
    usePlaylistStore().currentItem = { name: 'v.mp4', path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    (api.updatePlaybackPosition as Mock).mockRejectedValueOnce(
      new Error('boom'),
    );
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await (wrapper.vm as any).persistPlaybackPosition(20);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('persistPlaybackPosition is a no-op when no current item', async () => {
    usePlaylistStore().currentItem = null;
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    await (wrapper.vm as any).persistPlaybackPosition(15);
    expect(api.updatePlaybackPosition).not.toHaveBeenCalled();
  });

  it('persistPlaybackPosition rejects non-finite values', async () => {
    usePlaylistStore().currentItem = { name: 'v.mp4', path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    (api.updatePlaybackPosition as Mock).mockClear();
    await (wrapper.vm as any).persistPlaybackPosition(Number.NaN);
    await (wrapper.vm as any).persistPlaybackPosition(-1);
    expect(api.updatePlaybackPosition).not.toHaveBeenCalled();
  });

  it('updates video element muted state when isMuted changes', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const videoEl = (wrapper.vm as any).videoElement;
    expect(videoEl.muted).toBe(false);

    const controls = wrapper.findComponent(MediaControls);
    await controls.vm.$emit('toggle-mute');
    await flushPromises();
    expect(videoEl.muted).toBe(true);
  });

  it('handles video playing event to clear loading states', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    mockTranscoder.isTranscodingLoading.value = true;
    mockTranscoder.isBuffering.value = true;

    const videoPlayer = wrapper.findComponent(VideoPlayer);
    await videoPlayer.vm.$emit('playing');

    expect(mockTranscoder.isTranscodingLoading.value).toBe(false);
    expect(mockTranscoder.isBuffering.value).toBe(false);
    expect(mockTranscoder.stopTranscodingProgressPoll).toHaveBeenCalled();
  });

  it('handles image media error', async () => {
    usePlaylistStore().currentItem = { path: 'img.jpg' } as any;
    useLibraryStore().imageExtensionsSet = new Set(['.jpg']) as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    (wrapper.vm as any).handleMediaError();
    expect(mockMediaLoader.error.value).toBe('Failed to load image.');
  });

  it('handles video element update', async () => {
    const wrapper = mount(MediaDisplay);
    const mockEl = { id: 'test-video' } as any;
    (wrapper.vm as any).handleVideoElementUpdate(mockEl);
    expect(usePlayerStore().mainVideoElement).toStrictEqual(mockEl);
  });

  it('handles segment merging logic', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const controls = wrapper.findComponent(MediaControls);
    (controls.vm as any).watchedSegments = [{ start: 0, end: 10 }];

    // Add overlapping segment
    (wrapper.vm as any).addWatchedSegment(8, 15);
    expect((controls.vm as any).watchedSegments[0]).toEqual({
      start: 0,
      end: 15,
    });

    // Add non-overlapping segment
    (wrapper.vm as any).addWatchedSegment(20, 30);
    expect((controls.vm as any).watchedSegments.length).toBe(2);
  });

  it('handles other keys in global keydown', () => {
    mount(MediaDisplay);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
    // Should do nothing but not crash
  });

  it('handles video buffering event', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    const videoPlayer = wrapper.findComponent(VideoPlayer);
    await videoPlayer.vm.$emit('buffering', false);
    expect(mockTranscoder.setBuffering).toHaveBeenCalledWith(false);
  });

  it('handles time update without controls ref', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    const wrapper = mount(MediaDisplay);
    (wrapper.vm as any).mediaControlsRef = null;
    await (wrapper.vm as any).handleTimeUpdate(10);
    // Should return early and not crash
  });

  it('toggles play on space key when video player is not ready', () => {
    const wrapper = mount(MediaDisplay);
    (wrapper.vm as any).videoPlayerRef = null;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    // Should not crash
  });

  it('handles video pause directly', async () => {
    const wrapper = mount(MediaDisplay);
    await (wrapper.vm as any).handleVideoPause();
    // Should not crash
  });

  it('handles video element update with null', async () => {
    const wrapper = mount(MediaDisplay);
    (wrapper.vm as any).handleVideoElementUpdate(null);
    expect(usePlayerStore().mainVideoElement).toBeNull();
  });

  it('handles handleNext directly', () => {
    const wrapper = mount(MediaDisplay);
    (wrapper.vm as any).handleNext();
    expect(mockSlideshow.navigateMedia).toHaveBeenCalledWith(1);
  });

  it('handles trigger-transcode event', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();
    const videoPlayer = wrapper.findComponent(VideoPlayer);
    await videoPlayer.vm.$emit('trigger-transcode');
    expect(mockTranscoder.startTranscoding).toHaveBeenCalled();
  });

  it('handles openInVlc error', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.isVideoSupported.value = false;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    (api.openInVlc as Mock).mockResolvedValue({
      success: false,
      message: 'VLC error',
    });
    await wrapper.find('button.glass-button').trigger('click');
    expect(mockMediaLoader.error.value).toBe('VLC error');
  });

  it('handles seek when not transcoding and video exists', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.mediaUrl.value = 'url';
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    const videoEl = (wrapper.vm as any).videoElement;
    expect(videoEl).toBeTruthy();

    (wrapper.vm as any).handleSeek(50);
    expect(videoEl.currentTime).toBe(50);
  });

  it('handles openInVlc when already opening', async () => {
    usePlaylistStore().currentItem = { path: 'v.mp4' } as any;
    mockMediaLoader.isVideoSupported.value = false;
    const wrapper = mount(MediaDisplay);
    await flushPromises();

    (wrapper.vm as any).isOpeningVlc = true;
    await (wrapper.vm as any).openInVlc();
    expect(api.openInVlc).not.toHaveBeenCalled();
  });
});
