import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaGrid from '@/features/library/MediaGrid.vue';
import MediaGridItem from '@/features/library/MediaGridItem.vue';
import { api } from '../../../src/renderer/api/index';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import VirtualScroller from '@/components/atoms/VirtualScroller.vue';

// Mock dependencies
vi.mock('../../../src/renderer/api/index');

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    (ResizeObserverMock as any).lastCallback = callback;
  }
}
(ResizeObserverMock as any).lastCallback = null;
global.ResizeObserver = ResizeObserverMock as any;

describe('MediaGrid.vue (Virtualization Keys)', () => {
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
      `url://${path}`) as any;
    useLibraryStore().thumbnailUrlGenerator = ((path: string) =>
      `thumb://${path}`) as any;

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().isTimerRunning = false;

    useUIStore().gridMediaFiles = [];
    useUIStore().viewMode = 'grid';

    (api.getMediaUrlGenerator as any).mockResolvedValue(
      (path: string) => `url://${path}`,
    );
    (api.getThumbnailUrlGenerator as any).mockResolvedValue(
      (path: string) => `thumb://${path}`,
    );
  });

  it('reuses MediaGridItem components when scrolling (recycling rows)', async () => {
    // Setup enough items for multiple rows
    const items = Array.from({ length: 20 }, (_, i) => ({
      path: `/path/img${i}.jpg`,
      name: `img${i}.jpg`,
      id: `img${i}`,
    }));
    useUIStore().gridMediaFiles = items as any;

    // Use full mount with real VirtualScroller to test actual behavior
    const wrapper = mount(MediaGrid);

    await flushPromises();

    // Trigger resize to set column count
    const observerCallback = (ResizeObserverMock as any).lastCallback;
    // 1000px width -> usually 3 columns (md:grid-cols-3) or 4 depending on breakpoints
    // In MediaGrid: < 768 is 2, < 1024 is 3. So 1000px is 3 columns.
    observerCallback([
      {
        contentRect: { width: 1000, height: 800 },
        contentBoxSize: [{ inlineSize: 1000 }],
      },
    ]);
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // wait for columnCount to update
    await new Promise((resolve) => setTimeout(resolve, 50)); // wait for VirtualScroller watchEffect

    // VirtualScroller renders visible items.
    // Container height 800. Row height ~328.
    // Visible rows: 800/328 = ~2.4 -> 3 rows + buffer (2) = 5 rows.
    const scroller = wrapper.findComponent(VirtualScroller);
    // Initial: scrollTop 0.
    const mediaItems = wrapper.findAllComponents(MediaGridItem);
    expect(mediaItems.length).toBeGreaterThan(0);
    const firstPath = mediaItems[0].props('item').path;
    expect(firstPath).toBe('/path/img0.jpg');

    // Scroll down significantly
    const element = scroller.element as HTMLElement;
    element.scrollTop = 1000;
    await scroller.trigger('scroll');

    // Wait for update (and wait for setTimeout in VirtualScroller's requestAnimationFrame stub)
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick();
    await flushPromises();

    const updatedMediaItems = wrapper.findAllComponents(MediaGridItem);
    const newFirstPath = updatedMediaItems[0].props('item').path;

    // Should have changed
    expect(newFirstPath).not.toBe(firstPath);
    // And should be further down the list
    expect(newFirstPath).toContain('img');
  });
});
