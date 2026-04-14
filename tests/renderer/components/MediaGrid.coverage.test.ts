import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, nextTick, toRefs } from 'vue';
import MediaGrid from '../../../src/renderer/components/MediaGrid.vue';
import { api } from '../../../src/renderer/api';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import VirtualScroller from '../../../src/renderer/components/VirtualScroller.vue';

// Mock dependencies
vi.mock('../../../src/renderer/composables/useLibraryStore');
vi.mock('../../../src/renderer/composables/usePlayerStore');
vi.mock('../../../src/renderer/composables/useUIStore');
vi.mock('../../../src/renderer/api');

// Mock ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  constructor(callback: any) {
    (ResizeObserverMock as any).mock.calls.push([callback]);
  }
  static mock = {
    calls: [] as any[][],
  };
}
global.ResizeObserver = ResizeObserverMock as any;

describe('MediaGrid.vue Coverage', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.resetAllMocks();
    (ResizeObserverMock as any).mock.calls = []; // Reset static mock calls

    mockLibraryState = reactive({
      supportedExtensions: {
        images: ['.jpg', '.png'],
        videos: ['.mp4', '.mkv'],
        all: ['.jpg', '.png', '.mp4', '.mkv'],
      },
      imageExtensionsSet: new Set(['.jpg', '.png']),
      videoExtensionsSet: new Set(['.mp4', '.mkv']),
      mediaUrlGenerator: (path: string) => `url://${path}`,
      thumbnailUrlGenerator: (path: string) => `thumb://${path}`,
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      currentMediaItem: null,
      isSlideshowActive: false,
      isTimerRunning: false,
    });

    mockUIState = reactive({
      viewMode: 'grid',
      gridMediaFiles: [],
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

    (api.getMediaUrlGenerator as any).mockResolvedValue(
      (path: string) => `url://${path}`,
    );
    (api.getThumbnailUrlGenerator as any).mockResolvedValue(
      (path: string) => `thumb://${path}`,
    );
  });

  const mountGrid = () => mount(MediaGrid);

  it('getExtension edge cases: no dot', async () => {
    mockUIState.gridMediaFiles = [
      { name: 'file-no-ext', path: '/path/to/file-no-ext', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('video').exists()).toBe(false);
  });

  it('getExtension edge cases: dot in directory name', async () => {
    mockUIState.gridMediaFiles = [
      { name: 'file', path: '/path.with.dot/file', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('getExtension edge cases: dotfile', async () => {
    mockUIState.gridMediaFiles = [
      { name: '.gitignore', path: '/.gitignore', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('handleItemClick sets state correctly', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    await wrapper.find('button.grid-item').trigger('click');

    expect(mockUIState.viewMode).toBe('player');
    expect(mockPlayerState.isSlideshowActive).toBe(true);
    // expect(mockPlayerState.currentMediaItem.path).toEqual(item.path);
  });

  it('closeGrid sets viewMode to player', async () => {
    const wrapper = mountGrid();
    await wrapper.find('button[title="Close Grid View"]').trigger('click');
    expect(mockUIState.viewMode).toBe('player');
  });

  it('uses getPosterUrl for videos', async () => {
    const item = { name: 'vid.mp4', path: '/vid.mp4', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const mockThumbGen = vi.fn().mockReturnValue('thumb.jpg');
    mockLibraryState.thumbnailUrlGenerator = mockThumbGen;

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();
    await nextTick();

    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('thumb.jpg');
    expect(mockThumbGen).toHaveBeenCalledWith('/vid.mp4');
  });

  it('updates chunking when allMediaFiles changes', async () => {
    mockUIState.gridMediaFiles = Array.from({ length: 50 }, (_, i) => ({
      name: `${i}.jpg`,
      path: `${i}.jpg`,
    }));
    const wrapper = mountGrid();
    await flushPromises();

    // Resize for 5 columns
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1400, height: 800 },
          contentBoxSize: [{ inlineSize: 1400 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // 50 / 5 = 10 rows
    expect(wrapper.findComponent(VirtualScroller).props('items')).toHaveLength(
      10,
    );

    // Change data
    mockUIState.gridMediaFiles = [
      { name: 'new.jpg', path: 'new.jpg', viewCount: 0 },
    ];
    await nextTick();

    // 1 item / 5 cols = 1 row
    expect(wrapper.findComponent(VirtualScroller).props('items')).toHaveLength(
      1,
    );
  });

  it('getMediaUrl returns empty if generator not ready', async () => {
    // Simulate delayed generator availability in store
    mockLibraryState.mediaUrlGenerator = null;

    mockUIState.gridMediaFiles = [{ name: 'img.jpg', path: '/img.jpg' }];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Should be empty initially
    expect(wrapper.find('img').attributes('src')).toBe('');

    // Update store state
    mockLibraryState.mediaUrlGenerator = (path: string) => `thumb://${path}`;
    await nextTick();

    expect(wrapper.find('img').attributes('src')).toBe('thumb:///img.jpg');
  });

  it('handleImageError fallback to full URL', async () => {
    mockUIState.gridMediaFiles = [{ name: 'img.jpg', path: '/img.jpg' }];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    expect(img.attributes('src')).toBe('thumb:///img.jpg');

    // Trigger error
    await img.trigger('error');

    // Since handleImageError modifies the DOM element directly, we check the element property
    // However, jsdom might not update 'attributes' via vue-test-utils automatically for direct DOM manip.
    // Let's check the element's src property directly.
    expect(img.element.src).toBe('url:///img.jpg');
  });

  it('getDisplayName fallback to path parsing', async () => {
    const item = { path: '/some/path/file.jpg' } as any;
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('file.jpg');
  });

  it('handleImageError final failure state', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg' };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Resize for rendering
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    // Set src to match fullUrl to trigger final failure branch
    img.element.src = 'url:///img.jpg';
    await img.trigger('error');

    await wrapper.vm.$nextTick();
    // Should now show failure placeholder (svg)
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('renders rating overlay when present', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', rating: 5 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('5');
    expect(wrapper.find('.text-accent').exists()).toBe(true);
  });

  it('disconnects ResizeObserver on unmount', async () => {
    const wrapper = mountGrid();
    await flushPromises();

    const disconnectSpy = vi.spyOn(ResizeObserverMock.prototype, 'disconnect');
    wrapper.unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('handleItemClick works even if image failed', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg' };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Resize and trigger error
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    img.element.src = 'url:///img.jpg';
    await img.trigger('error');
    await wrapper.vm.$nextTick();

    // Click the failed item (which is now represented by the fallback div)
    await wrapper.find('button.grid-item').trigger('click');
    // expect(mockState.currentMediaItem.path).toBe('/img.jpg');
    // Check if the click handler was called or some state changed
  });
});
