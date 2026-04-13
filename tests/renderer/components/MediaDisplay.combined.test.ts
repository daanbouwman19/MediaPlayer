import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, reactive, toRefs, computed } from 'vue';
import MediaDisplay from '@/components/MediaDisplay.vue';
import MediaControls from '@/components/MediaControls.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useTranscoder } from '@/composables/useTranscoder';
import { useUIStore } from '@/composables/useUIStore';
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
        play: vi.fn(),
        load: vi.fn(),
        requestFullscreen: vi.fn(),
      };
      emit('update:video-element', mockVideo);
      return { reset: vi.fn(), togglePlay: vi.fn(), currentVideoTime: ref(0) };
    },
  },
}));

vi.mock('@/api');

vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/composables/usePlaylistStore');
vi.mock('@/composables/useMediaLoader');
vi.mock('@/composables/useTranscoder');

describe('MediaDisplay Combined Tests', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockPlaylistState: any;
  let mockUIState: any;
  let mockSlideshow: any;
  let mockMediaLoader: any;
  let mockTranscoder: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLibraryState = reactive({
      imageExtensionsSet: new Set(['.jpg', '.png']),
      videoExtensionsSet: new Set(['.mp4']),
      mediaUrlGenerator: (path: string) => `media://${path}`,
      mediaDirectories: [],
    });

    mockPlayerState = reactive({
      isSlideshowActive: false,
      playFullVideo: false,
      isTimerRunning: false,
    });

    mockPlaylistState = reactive({
      currentItem: null,
      history: [],
      queue: [],
    });

    mockUIState = reactive({
      mediaFilter: 'All',
      viewMode: 'player',
      isControlsVisible: true,
      isSidebarVisible: true,
      isSourcesModalVisible: false,
    });

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
      stopSlideshow: vi.fn(),
    });

    (usePlaylistStore as Mock).mockReturnValue({
      state: mockPlaylistState,
      currentItem: toRefs(mockPlaylistState).currentItem,
      hasPrevious: computed(() => mockPlaylistState.history.length > 0),
      hasNext: computed(() => mockPlaylistState.queue.length > 0),
      playNext: vi.fn(),
      playPrevious: vi.fn(),
    });

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
      startTranscoding: vi.fn(),
      resetTranscoderState: vi.fn(),
    };
    (useTranscoder as Mock).mockReturnValue(mockTranscoder);

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
      ...toRefs(mockUIState),
    });

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
    mockPlaylistState.currentItem = { path: '/test.jpg' };
    await flushPromises();
    expect(mockMediaLoader.loadMedia).toHaveBeenCalled();
  });

  it('updates rating', async () => {
    mockPlaylistState.currentItem = { path: '/test.jpg', rating: 0 };
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
});
