import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
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

// F52: MediaDisplay together with the real slideshow logic. Only a countdown
// that a long video suspended may resume on its own.

vi.mock('@/features/player/VideoPlayer.vue', () => ({
  default: {
    name: 'VideoPlayer',
    template: '<div class="video-player-mock"></div>',
    emits: ['update:video-element', 'play', 'pause', 'ended', 'loadedmetadata'],
    setup(_: unknown, { emit }: any) {
      emit('update:video-element', {
        currentTime: 0,
        duration: 100,
        paused: false,
        pause: vi.fn(),
        play: vi.fn().mockResolvedValue(undefined),
        load: vi.fn(),
      });
      return { reset: vi.fn(), togglePlay: vi.fn() };
    },
  },
}));

vi.mock('@/api');
vi.mock('@/composables/useMediaLoader');
vi.mock('@/composables/useTranscoder');

const image = (name: string) => ({ name, path: `/${name}` });

describe('MediaDisplay slideshow countdown (real useSlideshow)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(
      createTestingPinia({ stubActions: false, createSpy: vi.fn }),
    );
    useLibraryStore().supportedExtensions = {
      images: ['.jpg'],
      videos: ['.mp4'],
      all: ['.jpg', '.mp4'],
    };
    usePlayerStore().timerDuration = 5;
    usePlayerStore().isSlideshowActive = true;

    (useMediaLoader as Mock).mockReturnValue({
      isLoading: ref(false),
      mediaUrl: ref('media://current'),
      error: ref(null),
      isVideoSupported: ref(true),
      loadMedia: vi.fn().mockResolvedValue(undefined),
      cancelPendingLoad: vi.fn(),
    });
    (useTranscoder as Mock).mockReturnValue({
      isTranscodingMode: ref(false),
      isTranscodingLoading: ref(false),
      isBuffering: ref(false),
      transcodedDuration: ref(0),
      transcodingProgress: ref(0),
      currentTranscodeStartTime: ref(0),
      startTranscoding: vi.fn(),
      resetTranscoderState: vi.fn(),
      stopTranscodingProgressPoll: vi.fn(),
    });
  });

  afterEach(() => {
    usePlayerStore().stopSlideshow();
  });

  const videoPlayer = (wrapper: VueWrapper) =>
    wrapper.findComponent({ name: 'VideoPlayer' });

  it('stepping to the next image after a user pause does not restart the countdown', async () => {
    const playlist = usePlaylistStore();
    playlist.currentItem = image('a.jpg');
    playlist.queue = [image('b.jpg')];

    const wrapper = mount(MediaDisplay);
    await flushPromises();
    expect(usePlayerStore().isTimerRunning).toBe(false);

    wrapper.findComponent(MediaControls).vm.$emit('next');
    await flushPromises();

    expect(playlist.currentItem?.path).toBe('/b.jpg');
    expect(usePlayerStore().isTimerRunning).toBe(false);
    expect(usePlayerStore().slideshowTimerId).toBeNull();
  });

  it('a long video suspends the countdown, which resumes for the next item after it ends', async () => {
    const playlist = usePlaylistStore();
    playlist.currentItem = { name: 'long.mp4', path: '/long.mp4' };
    playlist.queue = [image('b.jpg')];
    useSlideshow().resumeSlideshowTimer();

    const wrapper = mount(MediaDisplay);
    await flushPromises();

    videoPlayer(wrapper).vm.$emit('loadedmetadata');
    expect(usePlayerStore().isTimerRunning).toBe(false);
    expect(usePlayerStore().isTimerPausedForVideo).toBe(true);

    videoPlayer(wrapper).vm.$emit('ended');
    await flushPromises();

    expect(playlist.currentItem?.path).toBe('/b.jpg');
    expect(usePlayerStore().isTimerRunning).toBe(true);
    expect(usePlayerStore().slideshowTimerId).not.toBeNull();
  });

  it('with "Pause Timer" on, pausing a video resumes only a countdown the video suspended', async () => {
    usePlayerStore().pauseTimerOnPlay = true;
    usePlaylistStore().currentItem = { name: 'clip.mp4', path: '/clip.mp4' };

    const wrapper = mount(MediaDisplay);
    await flushPromises();

    // The user had paused the slideshow: pausing the video keeps it paused.
    videoPlayer(wrapper).vm.$emit('play');
    videoPlayer(wrapper).vm.$emit('pause');
    expect(usePlayerStore().isTimerRunning).toBe(false);

    // Running countdown: playing suspends it, pausing the video resumes it.
    useSlideshow().toggleSlideshowTimer();
    videoPlayer(wrapper).vm.$emit('play');
    expect(usePlayerStore().isTimerRunning).toBe(false);
    videoPlayer(wrapper).vm.$emit('pause');
    expect(usePlayerStore().isTimerRunning).toBe(true);
  });
});
