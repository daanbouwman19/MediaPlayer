import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, computed } from 'vue';
import MediaGrid from '../../../src/renderer/components/MediaGrid.vue';
import type { MediaFile } from '../../../src/core/types';
import VirtualScroller from '../../../src/renderer/components/VirtualScroller.vue';

// Mock dependencies
vi.mock('../../../src/renderer/composables/useLibraryStore');
vi.mock('../../../src/renderer/composables/usePlayerStore');
vi.mock('../../../src/renderer/composables/useUIStore');
vi.mock('../../../src/renderer/composables/usePlaylistStore');
vi.mock('../../../src/renderer/api', () => ({
  api: {
    getMediaUrlGenerator: vi.fn(),
    getThumbnailUrlGenerator: vi.fn(),
  },
}));

const { useLibraryStore } =
  await import('../../../src/renderer/composables/useLibraryStore');
const { usePlayerStore } =
  await import('../../../src/renderer/composables/usePlayerStore');
const { useUIStore } =
  await import('../../../src/renderer/composables/useUIStore');
const { usePlaylistStore } =
  await import('../../../src/renderer/composables/usePlaylistStore');

// Typed ResizeObserver mock
let lastResizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock implements ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    lastResizeCallback = callback;
  }
}

global.ResizeObserver = ResizeObserverMock;

/** Helper: fire a resize event with the given container width */
const triggerResize = (width: number) => {
  lastResizeCallback?.(
    [
      {
        contentRect: { width, height: 800 } as DOMRectReadOnly,
        contentBoxSize: [{ inlineSize: width, blockSize: 800 }],
        borderBoxSize: [{ inlineSize: width, blockSize: 800 }],
        devicePixelContentBoxSize: [{ inlineSize: width, blockSize: 800 }],
        target: document.createElement('div'),
      },
    ],
    new ResizeObserverMock(() => {}),
  );
};

describe('MediaGrid.vue (Virtual Scrolling)', () => {
  let mockUIState: { gridMediaFiles: MediaFile[]; viewMode: string };
  let mockPlayerState: {
    currentMediaItem: MediaFile | null;
    isSlideshowActive: boolean;
    isTimerRunning: boolean;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastResizeCallback = null;

    mockPlayerState = reactive({
      currentMediaItem: null,
      isSlideshowActive: false,
      isTimerRunning: false,
    });

    mockUIState = reactive({
      gridMediaFiles: [] as MediaFile[],
      viewMode: 'grid',
    });

    vi.mocked(useLibraryStore).mockReturnValue({
      imageExtensionsSet: computed(() => new Set(['.jpg', '.png'])),
      videoExtensionsSet: computed(() => new Set(['.mp4'])),
      mediaUrlGenerator: computed(() => (p: string) => `url://${p}`),
      thumbnailUrlGenerator: computed(() => (p: string) => `thumb://${p}`),
      state: {},
    } as unknown as ReturnType<typeof useLibraryStore>);

    vi.mocked(usePlayerStore).mockReturnValue(
      mockPlayerState as unknown as ReturnType<typeof usePlayerStore>,
    );

    vi.mocked(useUIStore).mockReturnValue(
      mockUIState as unknown as ReturnType<typeof useUIStore>,
    );

    vi.mocked(usePlaylistStore).mockReturnValue({
      setQueue: vi.fn(),
      playNext: vi.fn((item: MediaFile) => {
        mockPlayerState.currentMediaItem = item;
      }),
    } as unknown as ReturnType<typeof usePlaylistStore>);
  });

  it('renders "No media files" when list is empty', async () => {
    const wrapper = mount(MediaGrid);
    await flushPromises();
    expect(wrapper.text()).toContain('No media files found');
  });

  it('calculates column count based on container width', async () => {
    const items: MediaFile[] = Array.from({ length: 10 }, (_, i) => ({
      path: `/path/img${i}.jpg`,
      name: `img${i}.jpg`,
    }));
    mockUIState.gridMediaFiles = items;

    const wrapper = mount(MediaGrid);
    await flushPromises();

    // Grid breakpoints: w < 640 → 2 cols, w < 1024 → 3 cols, w < 1280 → 4 cols, else → 5
    // 1000 < 1024 → 3 cols
    triggerResize(1000);
    await wrapper.vm.$nextTick();
    // In our tests, `requestAnimationFrame` is mocked to use `setTimeout(..., 0)`.
    // Wait for the ResizeObserver callback's requestAnimationFrame to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick(); // wait for computed

    const vm = wrapper.vm as any;
    expect(vm.columnCount).toBe(3);
  });

  it('virtualizes large lists correctly', async () => {
    const items: MediaFile[] = Array.from({ length: 1000 }, (_, i) => ({
      path: `/path/img${i}.jpg`,
      name: `img${i}.jpg`,
    }));
    mockUIState.gridMediaFiles = items;

    const wrapper = mount(MediaGrid);
    await flushPromises();

    // 1024 (not < 1024) but < 1280 → 4 cols → 250 rows
    triggerResize(1024);
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(VirtualScroller).exists()).toBe(true);

    const vm = wrapper.vm as typeof wrapper.vm & {
      chunkedItems: { id: string; startIndex: number }[];
    };
    expect(vm.chunkedItems.length).toBe(250);
  });

  it('handles item clicks correctly', async () => {
    const item: MediaFile = { path: '/path/test.jpg', name: 'test.jpg' };
    mockUIState.gridMediaFiles = [item];

    const wrapper = mount(MediaGrid);
    await flushPromises();

    triggerResize(1000);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const gridItems = wrapper.findAll('.grid-item');
    expect(gridItems.length).toBeGreaterThan(0);
    await gridItems[0].trigger('click');

    expect(mockPlayerState.currentMediaItem?.path).toBe(item.path);
    expect(mockUIState.viewMode).toBe('player');
  });
});
