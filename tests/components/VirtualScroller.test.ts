import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VirtualScroller from '../../src/renderer/components/atoms/VirtualScroller.vue';

// Mock ResizeObserver
let resizeCallback: (entries: any[]) => void;
const observeMock = vi.fn();
const disconnectMock = vi.fn();
const unobserveMock = vi.fn();

class ResizeObserverMock {
  constructor(callback: any) {
    resizeCallback = callback;
  }
  observe = observeMock;
  unobserve = unobserveMock;
  disconnect = disconnectMock;
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock);

// Mock requestAnimationFrame to execute immediately
vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
  fn(0);
  return 0;
});

describe('VirtualScroller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default scrollTop mock
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      value: 0,
      writable: true,
    });
    // Reset rAF mock to immediate
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const generateItems = (count: number) => {
    return Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      text: `Item ${i}`,
    }));
  };

  const setContainerHeight = async (height: number) => {
    if (resizeCallback) {
      resizeCallback([{ contentRect: { height } }]);
    }
  };

  it('renders correctly with items', async () => {
    const items = generateItems(100);
    const itemSize = 50;
    const wrapper = mount(VirtualScroller, {
      props: {
        items,
        itemSize,
        keyField: 'id',
      },
      slots: {
        default:
          '<template #default="{ item, index }"><div class="item">{{ item.text }} ({{ index }})</div></template>',
      },
    });

    // Simulate resize to set height
    await setContainerHeight(500);
    await wrapper.vm.$nextTick();

    // Check if total height spacer is correct
    const spacer = wrapper.find('div[style*="height: 5000px"]');
    expect(spacer.exists()).toBe(true);

    const renderedItems = wrapper.findAll('.item');
    expect(renderedItems.length).toBe(12);
    expect(renderedItems[0].text()).toBe('Item 0 (0)');
    expect(renderedItems[11].text()).toBe('Item 11 (11)');
  });

  it('updates visible items on scroll', async () => {
    const items = generateItems(100);
    const itemSize = 50;
    const wrapper = mount(VirtualScroller, {
      props: {
        items,
        itemSize,
        keyField: 'id',
        buffer: 0, // No buffer for easier calculation
      },
      slots: {
        default:
          '<template #default="{ item }"><div class="item">{{ item.text }}</div></template>',
      },
    });

    await setContainerHeight(500);
    await wrapper.vm.$nextTick();

    // Initial: 0 to 10 (0 to 500px).
    expect(wrapper.findAll('.item').length).toBe(10);
    expect(wrapper.findAll('.item')[0].text()).toBe('Item 0');

    // Scroll to 100px
    const element = wrapper.element as HTMLElement;
    element.scrollTop = 100;
    await wrapper.trigger('scroll');

    const renderedItems = wrapper.findAll('.item');
    expect(renderedItems.length).toBe(10);
    expect(renderedItems[0].text()).toBe('Item 2');
    expect(renderedItems[9].text()).toBe('Item 11');
  });

  it('handles custom buffer', async () => {
    const items = generateItems(100);
    const itemSize = 50;
    const wrapper = mount(VirtualScroller, {
      props: {
        items,
        itemSize,
        buffer: 5,
      },
      slots: {
        default:
          '<template #default="{ item }"><div class="item">{{ item.text }}</div></template>',
      },
    });

    await setContainerHeight(500);
    await wrapper.vm.$nextTick();

    // Initial: 0 to 10. Buffer 5.
    // startIndex = 0 - 5 = -5 -> 0.
    // endIndex = 10 + 5 = 15.
    // Items 0..14. Count 15.
    expect(wrapper.findAll('.item').length).toBe(15);
  });

  it('handles empty items', async () => {
    const wrapper = mount(VirtualScroller, {
      props: {
        items: [],
        itemSize: 50,
      },
    });

    await setContainerHeight(500);
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('.item').length).toBe(0);
    // Spacer height should be 0
    const spacer = wrapper.find('div[style*="height: 0px"]');
    expect(spacer.exists()).toBe(true);
  });

  it('uses ResizeObserver to update container height', async () => {
    const items = generateItems(100);
    const wrapper = mount(VirtualScroller, {
      props: { items, itemSize: 50 },
    });

    expect(observeMock).toHaveBeenCalledWith(wrapper.element);

    await setContainerHeight(500);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('div[style*="height: 5000px"]').exists()).toBe(true);

    wrapper.unmount();
    expect(disconnectMock).toHaveBeenCalled();
  });

  it('uses index as key fallback', async () => {
    // Items without 'id'
    const items = [{ text: 'A' }, { text: 'B' }];
    const wrapper = mount(VirtualScroller, {
      props: {
        items,
        itemSize: 50,
        // keyField defaults to 'id', so lookup fails, falls back to index
      },
      slots: {
        default:
          '<template #default="{ item }"><div class="item">{{ item.text }}</div></template>',
      },
    });

    await setContainerHeight(200);
    await wrapper.vm.$nextTick();

    const renderedItems = wrapper.findAll('.item');
    expect(renderedItems.length).toBe(2);
    expect(renderedItems[0].text()).toBe('A');
    expect(renderedItems[1].text()).toBe('B');
  });

  it('handles items with holes', async () => {
    const items = new Array(10);
    items[0] = { id: '0', text: 'Item 0' };
    // items[1] is undefined
    items[2] = { id: '2', text: 'Item 2' };

    const wrapper = mount(VirtualScroller, {
      props: { items, itemSize: 50 },
      slots: {
        default:
          '<template #default="{ item }"><div class="item">{{ item.text }}</div></template>',
      },
    });

    await setContainerHeight(500);
    await wrapper.vm.$nextTick();

    // Should skip index 1
    const renderedItems = wrapper.findAll('.item');
    expect(renderedItems.length).toBeGreaterThan(0);
    const texts = renderedItems.map((w) => w.text());
    expect(texts).toContain('Item 0');
    expect(texts).toContain('Item 2');
    // Ensure it didn't crash
  });

  it('throttles scroll events', async () => {
    let frameCallback: FrameRequestCallback | null = null;
    const rAF = vi.fn((fn: FrameRequestCallback) => {
      frameCallback = fn;
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', rAF);

    const wrapper = mount(VirtualScroller, {
      props: { items: generateItems(100), itemSize: 50 },
    });
    await setContainerHeight(500);
    await wrapper.vm.$nextTick();

    // First scroll should schedule a frame
    await wrapper.trigger('scroll');
    expect(rAF).toHaveBeenCalledTimes(1);

    // Second scroll should be ignored (throttled)
    await wrapper.trigger('scroll');
    expect(rAF).toHaveBeenCalledTimes(1);

    // Execute the animation frame
    if (frameCallback) {
      (frameCallback as any)(0);
    }
    await wrapper.vm.$nextTick();

    // A new scroll should now schedule another frame
    await wrapper.trigger('scroll');
    expect(rAF).toHaveBeenCalledTimes(2);
  });
});
