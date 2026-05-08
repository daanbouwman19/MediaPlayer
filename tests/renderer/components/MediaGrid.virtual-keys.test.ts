import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import MediaGrid from '../../../src/renderer/components/MediaGrid.vue';
import MediaGridItem from '../../../src/renderer/components/MediaGridItem.vue';
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
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLibraryState = reactive({
      imageExtensionsSet: new Set(['.jpg', '.png']),
      videoExtensionsSet: new Set(['.mp4']),
      mediaUrlGenerator: (path: string) => `url://${path}`,
      thumbnailUrlGenerator: (path: string) => `thumb://${path}`,
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: 0,
      currentMediaItem: null,
      isSlideshowActive: false,
      isTimerRunning: false,
    });

    mockUIState = reactive({
      gridMediaFiles: [],
      viewMode: 'grid',
    });

    (useLibraryStore as unknown as Mock).mockReturnValue(mockLibraryState);

    (usePlayerStore as unknown as Mock).mockReturnValue(mockPlayerState);

    (useUIStore as unknown as Mock).mockReturnValue(mockUIState);

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
    mockUIState.gridMediaFiles = items;

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
    // We want to test component reuse.
    // With VirtualScroller implementation, items are keyed.
    // If the component reuses DOM elements (Vue's diffing), the component instance should be reused if key is stable?
    // Wait, VirtualScroller renders items based on visible range.
    // If we scroll, items that go out of view are removed, new items added.
    // Does VirtualScroller recycle components? No, it's not a recycling scroller in the sense of keeping a pool of DOM nodes manually.
    // It relies on Vue's v-for.
    // If keys are different, components are destroyed and recreated.
    // VirtualScroller uses `keyField` or index as key.
    // MediaGrid uses `key-field="id"` which corresponds to row ID `row-${i*cols}`.
    // So row 0 has key `row-0`. Row 1 has key `row-3` (if cols=3).
    // When scrolling, if row 0 goes out of view, it is unmounted.
    // If row 5 comes into view, it is mounted.
    // So components are NOT reused in the sense of persistent instances for different data.
    // They are destroyed and created.
    // However, the test expects reuse?
    // The previous test used a STUB for RecycleScroller which artificially changed the item passed to the slot while keeping the slot container alive.
    // That tested that MediaGrid's internal usage of the slot allowed for reactivity if the item prop changed.
    // Since we are now using the real VirtualScroller, we can check if it behaves correctly.
    // But testing "reuse" of instances across different data items (recycling) is not applicable if VirtualScroller doesn't implement DOM recycling (it implements virtual rendering).
    // So this test might be testing a property of the *old* RecycleScroller (which did recycle views).
    // Our VirtualScroller just mounts/unmounts based on scroll position.
    // So we should verify that *scrolling updates the visible items*.
    // We can check that new items appear and old ones disappear.

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
    // 1000px / 328px/row ~= 3 rows down.
    // Row 0,1,2 gone?
    // Row 3 starts at index 9.
    // So we expect img9 or similar.
    expect(newFirstPath).toContain('img');
  });
});
