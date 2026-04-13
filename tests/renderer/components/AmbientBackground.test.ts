import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, toRefs, computed } from 'vue';
import AmbientBackground from '../../../src/renderer/components/AmbientBackground.vue';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { usePlaylistStore } from '../../../src/renderer/composables/usePlaylistStore';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { api } from '../../../src/renderer/api';

vi.mock('../../../src/renderer/composables/usePlayerStore');
vi.mock('../../../src/renderer/composables/usePlaylistStore');
vi.mock('../../../src/renderer/composables/useLibraryStore');
vi.mock('../../../src/renderer/api');

describe('AmbientBackground.vue', () => {
  let mockPlayerState: any;
  let mockPlaylistState: any;
  let mockLibraryState: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockPlayerState = reactive({
      mainVideoElement: null,
    });
    mockPlaylistState = reactive({
      currentItem: null,
      history: [],
      queue: [],
    });
    mockLibraryState = reactive({
      supportedExtensions: { images: ['.jpg', '.png'], videos: ['.mp4'] },
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
    });
    (usePlaylistStore as Mock).mockReturnValue({
      state: mockPlaylistState,
      currentItem: toRefs(mockPlaylistState).currentItem,
      hasPrevious: computed(() => mockPlaylistState.history.length > 0),
      hasNext: computed(() => mockPlaylistState.queue.length > 0),
    });
    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
    });

    // Mock API
    vi.mocked(api.loadFileAsDataURL).mockResolvedValue({
      type: 'data-url',
      url: 'data:image/png;base64,fake',
    });

    // Mock Canvas context
    const mockContext = {
      drawImage: vi.fn(),
    };
    // Mock HTMLCanvasElement.prototype.getContext
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      mockContext as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders correctly', () => {
    const wrapper = mount(AmbientBackground);
    expect(wrapper.find('.ambient-background-container').exists()).toBe(true);
    expect(wrapper.find('canvas').exists()).toBe(true);
  });

  it('loads media when currentMediaItem changes (Image)', async () => {
    mockPlaylistState.currentItem = { path: '/test/image.jpg' };

    // Mock Image loading
    const originalImage = window.Image;
    window.Image = class FakeImage {
      onload: any;
      _src: string = '';
      set src(v: string) {
        this._src = v;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
      get src() {
        return this._src;
      }
    } as any;

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    // Verify api called
    expect(api.loadFileAsDataURL).toHaveBeenCalledWith('/test/image.jpg');

    // Wait for onload timeout
    vi.advanceTimersByTime(20);

    // Verify drawImage called
    const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    expect(ctx?.drawImage).toHaveBeenCalled();

    window.Image = originalImage;
    wrapper.unmount();
  });

  it('starts video loop when video', async () => {
    mockPlaylistState.currentItem = { path: '/test/video.mp4' };
    const mockVideo = { paused: false, ended: false } as HTMLVideoElement;
    mockPlayerState.mainVideoElement = mockVideo;

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    // Force a frame
    vi.advanceTimersByTime(50);

    const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');

    expect(ctx?.drawImage).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('handles api load error', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockPlaylistState.currentItem = { path: '/test/fail.jpg' };
    vi.mocked(api.loadFileAsDataURL).mockRejectedValue(new Error('Load fail'));

    mount(AmbientBackground);
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to load background media:',
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it('handles http-url media', async () => {
    mockPlaylistState.currentItem = { path: '/test/image.jpg' };
    vi.mocked(api.loadFileAsDataURL).mockResolvedValue({
      type: 'http-url',
      url: 'http://foo.com/img.jpg',
    });

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    expect(wrapper.vm).toBeDefined();
    // Just verify no crash and it tries to load
    expect(api.loadFileAsDataURL).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('handles no media', async () => {
    mockPlaylistState.currentItem = null;
    await flushPromises();
    expect(api.loadFileAsDataURL).not.toHaveBeenCalled();
  });
});
