import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AmbientBackground from '@/features/player/AmbientBackground.vue';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { usePlaylistStore } from '../../../src/renderer/composables/usePlaylistStore';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { api } from '../../../src/renderer/api/index';

vi.mock('../../../src/renderer/api/index');

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

  it('handles other result types or missing url', async () => {
    usePlaylistStore().currentItem = { path: '/test/image.jpg' } as any;
    vi.mocked(api.loadFileAsDataURL).mockResolvedValue({
      type: 'unknown-type' as any,
      url: null as any,
    });

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    expect(wrapper.vm).toBeDefined();
    wrapper.unmount();
  });

  it('handles image onload when canvas is missing on callback', async () => {
    usePlaylistStore().currentItem = { path: '/test/image.jpg' } as any;

    const originalImage = window.Image;
    let triggerOnload: any = null;
    window.Image = class FakeImage {
      onload: any;
      set src(_v: string) {
        triggerOnload = () => {
          if (this.onload) this.onload();
        };
      }
      get src() {
        return '';
      }
    } as any;

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    // Set canvas to null before calling onload
    (wrapper.vm as any).canvas = null;

    if (triggerOnload) triggerOnload();

    expect(wrapper.vm).toBeDefined();
    window.Image = originalImage;
    wrapper.unmount();
  });

  it('skips video loop drawing if video is paused, ended, or missing canvas/context', async () => {
    usePlaylistStore().currentItem = { path: '/test/video.mp4' } as any;

    // Paused video
    const mockVideo = { paused: true, ended: false } as any;
    usePlayerStore().mainVideoElement = mockVideo;

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    vi.advanceTimersByTime(50);
    const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    expect(ctx?.drawImage).not.toHaveBeenCalled();

    // Draw throws an error
    mockVideo.paused = false;
    vi.mocked(ctx?.drawImage as any).mockImplementation(() => {
      throw new Error('Draw error');
    });
    vi.advanceTimersByTime(50);

    // Verify it doesn't crash on throw
    expect(wrapper.vm).toBeDefined();
    wrapper.unmount();
  });

  it('does not build a data URL for videos (frames come from the player)', async () => {
    usePlaylistStore().currentItem = { path: '/test/video.mp4' } as any;
    usePlayerStore().mainVideoElement = {
      paused: false,
      ended: false,
    } as HTMLVideoElement;

    const wrapper = mount(AmbientBackground);
    await flushPromises();
    vi.advanceTimersByTime(50);

    expect(api.loadFileAsDataURL).not.toHaveBeenCalled();
    const ctx = (
      wrapper.find('canvas').element as HTMLCanvasElement
    ).getContext('2d');
    expect(ctx?.drawImage).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not reallocate the canvas on every video frame', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {
      value: 1366,
      configurable: true,
    });
    usePlaylistStore().currentItem = { path: '/test/video.mp4' } as any;
    usePlayerStore().mainVideoElement = {
      paused: false,
      ended: false,
    } as HTMLVideoElement;

    const wrapper = mount(AmbientBackground);
    const canvas = wrapper.find('canvas').element as HTMLCanvasElement;
    let width = 0;
    let widthWrites = 0;
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        widthWrites++;
        width = Math.floor(value);
      },
    });
    await flushPromises();

    vi.advanceTimersByTime(500); // many animation frames
    expect(width).toBe(136);
    expect(widthWrites).toBe(1);

    wrapper.unmount();
    Object.defineProperty(window, 'innerWidth', {
      value: originalWidth,
      configurable: true,
    });
  });

  it('ignores a late result for the previous item', async () => {
    const originalImage = window.Image;
    const loadedSrcs: string[] = [];
    window.Image = class FakeImage {
      onload: (() => void) | null = null;
      set src(value: string) {
        loadedSrcs.push(value);
        setTimeout(() => this.onload?.(), 10);
      }
    } as any;

    let resolveA!: (value: any) => void;
    vi.mocked(api.loadFileAsDataURL).mockImplementation((path: string) =>
      path === '/test/a.jpg'
        ? new Promise((resolve) => (resolveA = resolve))
        : Promise.resolve({ type: 'data-url', url: 'data:b' }),
    );

    usePlaylistStore().currentItem = { path: '/test/a.jpg' } as any;
    const wrapper = mount(AmbientBackground);
    await flushPromises();

    usePlaylistStore().currentItem = { path: '/test/b.jpg' } as any;
    await flushPromises();
    resolveA({ type: 'data-url', url: 'data:a' });
    await flushPromises();
    vi.advanceTimersByTime(20);

    expect(loadedSrcs).toEqual(['data:b']);
    expect((wrapper.vm as any).mediaUrl).toBe('data:b');

    window.Image = originalImage;
    wrapper.unmount();
  });

  it('does not draw an image that finished loading after the item changed', async () => {
    const originalImage = window.Image;
    const images: { onload: (() => void) | null }[] = [];
    window.Image = class FakeImage {
      onload: (() => void) | null = null;
      constructor() {
        images.push(this);
      }
      set src(_value: string) {}
    } as any;

    usePlaylistStore().currentItem = { path: '/test/a.jpg' } as any;
    const wrapper = mount(AmbientBackground);
    await flushPromises();
    const ctx = (
      wrapper.find('canvas').element as HTMLCanvasElement
    ).getContext('2d');

    usePlaylistStore().currentItem = { path: '/test/video.mp4' } as any;
    await flushPromises();
    images[0].onload?.();

    expect(ctx?.drawImage).not.toHaveBeenCalled();
    window.Image = originalImage;
    wrapper.unmount();
  });

  it('handles no media', async () => {
    usePlaylistStore().currentItem = null;
    await flushPromises();
    expect(api.loadFileAsDataURL).not.toHaveBeenCalled();
  });

  it('cancels previous animation frame when loading new media', async () => {
    usePlaylistStore().currentItem = { path: '/test/video1.mp4' } as any;
    const mockVideo = { paused: false, ended: false } as HTMLVideoElement;
    usePlayerStore().mainVideoElement = mockVideo;

    const wrapper = mount(AmbientBackground);
    await flushPromises();

    vi.advanceTimersByTime(50);

    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame');

    usePlaylistStore().currentItem = { path: '/test/video2.mp4' } as any;
    await flushPromises();

    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
    wrapper.unmount();
  });
});
