import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AmbientBackground from '../../../src/renderer/components/AmbientBackground.vue';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { usePlaylistStore } from '../../../src/renderer/composables/usePlaylistStore';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { api } from '../../../src/renderer/api';

vi.mock('../../../src/renderer/api');

describe('AmbientBackground.vue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    usePlayerStore().mainVideoElement = null;

    usePlaylistStore().currentItem = null;
    usePlaylistStore().history = [];
    usePlaylistStore().queue = [];

    useLibraryStore().supportedExtensions = {
      images: ['.jpg', '.png'],
      videos: ['.mp4'],
      all: ['.jpg', '.png', '.mp4'],
    };

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
    usePlaylistStore().currentItem = { path: '/test/image.jpg' } as any;

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
    usePlaylistStore().currentItem = { path: '/test/video.mp4' } as any;
    const mockVideo = { paused: false, ended: false } as HTMLVideoElement;
    usePlayerStore().mainVideoElement = mockVideo;

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
    usePlaylistStore().currentItem = { path: '/test/fail.jpg' } as any;
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
    usePlaylistStore().currentItem = { path: '/test/image.jpg' } as any;
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
    usePlaylistStore().currentItem = null;
    await flushPromises();
    expect(api.loadFileAsDataURL).not.toHaveBeenCalled();
  });
});
