import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import VirtualScroller from '../../../src/renderer/components/VirtualScroller.vue';

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

describe('VirtualScroller.vue', () => {
  type TestItem = { id: number; name: string };
  let items: TestItem[];
  const itemSize = 50;
  const containerHeight = 200;

  beforeEach(() => {
    // Mock requestAnimationFrame for scroll throttling
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    // Generate 100 items
    items = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders visible items correctly', async () => {
    const wrapper = mount(VirtualScroller, {
      props: {
        items,
        itemSize,
        keyField: 'id',
        buffer: 2,
      },
    });

    await flushPromises();

    // Trigger ResizeObserver to set container height
    const observerCallback = (ResizeObserverMock as any).lastCallback;
    observerCallback([
      {
        contentRect: { width: 400, height: containerHeight },
      },
    ]);
    await wrapper.vm.$nextTick();

    // Visible range:
    // Container height: 200. Item size: 50. Visible items: 4.
    // Buffer: 2.
    // Start index: 0. End index: 4 + 2 = 6.
    // So visible items should be indices 0 to 5 (inclusive) -> 6 items.

    // Wait for update
    await wrapper.vm.$nextTick();

    // Check visible items count. It returns visible items array.
    // However, VirtualScroller renders children using v-for.
    // We can access wrapper.vm.visibleItems if we expose it or assume internal state?
    // Or check rendered DOM.
    // VirtualScroller renders a slot for each item.
    // Let's assume we render something in slot.

    // Check internal state (computed property) via vm
    // visibleItems is computed, usually exposed.
    const visibleItems = (wrapper.vm as any).visibleItems;
    expect(visibleItems.length).toBe(6);
    expect(visibleItems[0].index).toBe(0);
    expect(visibleItems[5].index).toBe(5);
  });

  it('updates visible items on scroll', async () => {
    const wrapper = mount(VirtualScroller, {
      props: {
        items,
        itemSize,
        keyField: 'id',
        buffer: 2,
      },
    });

    await flushPromises();

    const observerCallback = (ResizeObserverMock as any).lastCallback;
    observerCallback([
      {
        contentRect: { width: 400, height: containerHeight },
      },
    ]);
    await wrapper.vm.$nextTick();

    // Scroll down by 100px (2 items)
    const scroller = wrapper.find('.overflow-y-auto');
    scroller.element.scrollTop = 100;
    await scroller.trigger('scroll');

    // Trigger RequestAnimationFrame
    // The component uses window.requestAnimationFrame.
    // We need to mock/advance timers or trigger it.
    // Vitest uses fake timers if enabled.
    // Or we can just wait.

    // Wait for next tick/raf
    await vi.advanceTimersByTimeAsync(50);
    await wrapper.vm.$nextTick();

    // Recalculate:
    // ScrollTop: 100.
    // Start index: floor(100/50) - 2 = 0.
    // End index: ceil((100+200)/50) + 2 = ceil(6) + 2 = 8.
    // Visible range: 0 to 8 (exclusive) -> 0 to 7. 8 items?

    // Wait, let's trace logic in component:
    // startIndex = Math.floor(currentScroll / size) - buffer;
    // startIndex = 100/50 - 2 = 2 - 2 = 0.

    // endIndex = Math.ceil((currentScroll + height) / size) + buffer;
    // endIndex = ceil((100 + 200) / 50) + 2 = 6 + 2 = 8.

    // Loop: for (let i = startIndex; i < endIndex; i++)
    // i goes from 0 to 7.
    // Length is 8.

    // Wait, visibleItems length check.
    const visibleItems = (wrapper.vm as any).visibleItems;
    expect(visibleItems.length).toBe(8);
    expect(visibleItems[0].index).toBe(0);
    expect(visibleItems[7].index).toBe(7);
  });
});
