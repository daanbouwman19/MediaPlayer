import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaGrid from '../../../src/renderer/components/MediaGrid.vue';
import type { MediaFile } from '../../../src/core/types';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { usePlaylistStore } from '../../../src/renderer/composables/usePlaylistStore';
import VirtualScroller from '../../../src/renderer/components/VirtualScroller.vue';

vi.mock('../../../src/renderer/api', () => ({
  api: {
    getMediaUrlGenerator: vi.fn(),
    getThumbnailUrlGenerator: vi.fn(),
  },
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
    lastResizeCallback = null;

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    // Set Pinia store state
    useLibraryStore().imageExtensionsSet = new Set(['.jpg', '.png']) as any;
    useLibraryStore().videoExtensionsSet = new Set(['.mp4']) as any;
    useLibraryStore().mediaUrlGenerator = ((p: string) => `url://${p}`) as any;
    useLibraryStore().thumbnailUrlGenerator = ((p: string) => `thumb://${p}`) as any;

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().isTimerRunning = false;

    useUIStore().gridMediaFiles = [] as any;
    useUIStore().viewMode = 'grid';

    usePlaylistStore().queue = [];
    usePlaylistStore().currentItem = null;
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
    useUIStore().gridMediaFiles = items as any;

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

    const vm = wrapper.vm as typeof wrapper.vm & { columnCount: number };
    expect(vm.columnCount).toBe(3);
  });

  it('virtualizes large lists correctly', async () => {
    const items: MediaFile[] = Array.from({ length: 1000 }, (_, i) => ({
      path: `/path/img${i}.jpg`,
      name: `img${i}.jpg`,
    }));
    useUIStore().gridMediaFiles = items as any;

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
    useUIStore().gridMediaFiles = [item] as any;

    const wrapper = mount(MediaGrid);
    await flushPromises();

    triggerResize(1000);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const gridItems = wrapper.findAll('.grid-item');
    expect(gridItems.length).toBeGreaterThan(0);
    await gridItems[0].trigger('click');

    expect(usePlaylistStore().playNext).toHaveBeenCalledWith(
      expect.objectContaining({ path: item.path }),
    );
    expect(useUIStore().viewMode).toBe('player');
  });
});
