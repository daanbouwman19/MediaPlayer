import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import ProgressBar from '@/components/atoms/ProgressBar.vue';

describe('ProgressBar Coverage Boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock getBoundingClientRect
    Element.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
      width: 100,
      height: 40,
      top: 0,
      left: 0,
      bottom: 40,
      right: 100,
    });

    // Mock Canvas context
    const mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({
        addColorStop: vi.fn(),
      }),
    };
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);

    // Mock ResizeObserver
    global.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    } as any;

    // Mock requestAnimationFrame
    global.requestAnimationFrame = vi.fn().mockImplementation((cb) => cb());
  });

  it('draws heatmap with full data (motion)', async () => {
    mount(ProgressBar, {
      props: {
        currentTime: 50,
        duration: 100,
        buffered: 80,
        heatmap: {
          points: 10,
          audio: [],
          motion: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        },
        watchedSegments: [{ start: 10, end: 20 }],
      },
    });
    await flushPromises();
  });

  it('draws heatmap with audio data fallback', async () => {
    mount(ProgressBar, {
      props: {
        currentTime: 50,
        duration: 100,
        heatmap: {
          points: 5,
          audio: [-10, -20, -30, -40, -50],
          motion: [],
        },
      },
    });
  });

  it('draws heatmap fallback with no data', async () => {
    mount(ProgressBar, {
      props: {
        currentTime: 50,
        duration: 100,
        heatmap: null,
      },
    });
  });

  it('handles mouse interactions', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });

    const container = wrapper.find('.progress-container');
    const containerEl = container.element;

    // Mouse Down
    await container.trigger('mousedown', { clientX: 50 });
    expect((wrapper.vm as any).isDragging).toBe(true);
    expect(wrapper.emitted('scrub-start')).toBeTruthy();

    // Mouse Move (on window)
    const moveEvent = new MouseEvent('mousemove', { clientX: 75 });
    Object.defineProperty(moveEvent, 'target', { value: containerEl });
    window.dispatchEvent(moveEvent);
    expect((wrapper.vm as any).localPreviewTime).toBe(75);

    // Mouse Up (on window)
    window.dispatchEvent(new MouseEvent('mouseup'));
    expect((wrapper.vm as any).isDragging).toBe(false);
    expect(wrapper.emitted('seek')![0]).toEqual([75]);
    expect(wrapper.emitted('scrub-end')).toBeTruthy();
  });

  it('handles touch interactions', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });

    const container = wrapper.find('.progress-container');
    const containerEl = container.element;

    // Touch Start
    await container.trigger('touchstart', { touches: [{ clientX: 20 }] });
    expect((wrapper.vm as any).isDragging).toBe(true);

    // Touch Move
    const touchMoveEvent = new TouchEvent('touchmove', {
      touches: [{ clientX: 40 } as any],
    });
    Object.defineProperty(touchMoveEvent, 'target', { value: containerEl });
    touchMoveEvent.preventDefault = vi.fn();
    window.dispatchEvent(touchMoveEvent);
    expect(touchMoveEvent.preventDefault).toHaveBeenCalled();

    // Touch End
    window.dispatchEvent(new TouchEvent('touchend'));
    expect(wrapper.emitted('seek')![0]).toEqual([40]);
  });

  it('handles keyboard boundaries', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 98, duration: 100 },
    });

    const container = wrapper.find('.progress-container');

    // Right boundary
    await container.trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('seek')![0]).toEqual([100]);

    // Left boundary
    await wrapper.setProps({ currentTime: 2 });
    await container.trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('seek')![1]).toEqual([0]);
  });

  it('handles focus and hover states', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });

    const container = wrapper.find('.progress-container');

    await container.trigger('mouseenter');
    expect((wrapper.vm as any).isHovering).toBe(true);

    await container.trigger('mouseleave');
    expect((wrapper.vm as any).isHovering).toBe(false);
  });

  it('formatTime handles invalid values', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: NaN, duration: Infinity },
    });
    await wrapper.trigger('mouseenter');
    expect(wrapper.text()).toContain('0:00');
  });

  it('draws heatmap while dragging', async () => {
    const wrapper = mount(ProgressBar, {
      props: {
        currentTime: 10,
        duration: 100,
        heatmap: { points: 10, motion: [1, 2], audio: [] },
      },
    });

    (wrapper.vm as any).isDragging = true;
    (wrapper.vm as any).localPreviewTime = 50;
    await flushPromises();
    // This should hit the isDragging branch in drawHeatmap
  });

  it('draws heatmap with only audio data', async () => {
    mount(ProgressBar, {
      props: {
        currentTime: 10,
        duration: 100,
        heatmap: { points: 10, motion: [], audio: [-10, -20] },
      },
    });
    await flushPromises();
  });

  it('draws heatmap with mixed data (hitting motion primarily)', async () => {
    mount(ProgressBar, {
      props: {
        currentTime: 10,
        duration: 100,
        heatmap: { points: 10, motion: [5, 5], audio: [-10, -10] },
      },
    });
    await flushPromises();
  });

  it('handles keyboard page up/down with boundaries', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 5, duration: 100 },
    });

    const container = wrapper.find('.progress-container');

    // PageDown should clamp to 0
    await container.trigger('keydown', { key: 'PageDown' });
    expect(wrapper.emitted('seek')![0]).toEqual([0]);

    // PageUp should clamp to duration if we were at 95
    await wrapper.setProps({ currentTime: 95 });
    await container.trigger('keydown', { key: 'PageUp' });
    expect(wrapper.emitted('seek')![1]).toEqual([100]);
  });

  it('handles focus state', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    (wrapper.vm as any).isFocused = true;
    await flushPromises();
    expect(wrapper.find('.scale-100').exists()).toBe(true);
  });

  it('updateTime returns early if not dragging', () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    (wrapper.vm as any).updateTime(new MouseEvent('mousemove'));
    expect((wrapper.vm as any).localPreviewTime).toBe(0);
  });

  it('keeps tracking the bar while the cursor is dragged off it', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 45, duration: 100 },
    });
    const container = wrapper.find('.progress-container');

    await container.trigger('mousedown', { clientX: 45 });

    // Window-level moves target whatever is under the cursor, e.g. the
    // video a few pixels above the bar.
    const moveEvent = new MouseEvent('mousemove', { clientX: 60 });
    Object.defineProperty(moveEvent, 'target', { value: document.body });
    window.dispatchEvent(moveEvent);
    expect((wrapper.vm as any).localPreviewTime).toBe(60);

    // Past the end of the bar clamps to the end instead of jumping to 0.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 }));
    expect((wrapper.vm as any).localPreviewTime).toBe(100);

    window.dispatchEvent(new MouseEvent('mouseup'));
    expect(wrapper.emitted('seek')![0]).toEqual([100]);
  });

  it('keeps the last preview time for events without a usable point', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('touchstart', { touches: [{ clientX: 30 }] });

    const touchMove = new TouchEvent('touchmove', { touches: [] });
    window.dispatchEvent(touchMove);
    expect((wrapper.vm as any).localPreviewTime).toBe(30);

    window.dispatchEvent(new TouchEvent('touchend'));
    expect(wrapper.emitted('seek')![0]).toEqual([30]);
  });

  it('keeps the last preview time while the bar has no size', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    (Element.prototype.getBoundingClientRect as any).mockReturnValue({
      width: 0,
      left: 0,
    });
    await wrapper
      .find('.progress-container')
      .trigger('mousedown', { clientX: 50 });
    expect((wrapper.vm as any).localPreviewTime).toBe(10);
    window.dispatchEvent(new MouseEvent('mouseup'));
  });

  it('shows the scrubber handle for keyboard focus, with a focus ring class', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    const container = wrapper.find('.progress-container');
    const el = container.element as HTMLElement;
    expect(container.classes()).toContain('focus-visible:ring-2');

    // Control what :focus-visible reports; other selectors behave normally.
    const realMatches = Element.prototype.matches;
    let focusVisible: boolean | 'unsupported' = true;
    Object.defineProperty(el, 'matches', {
      configurable: true,
      value(this: Element, selector: string) {
        if (selector !== ':focus-visible') {
          return realMatches.call(this, selector);
        }
        if (focusVisible === 'unsupported') {
          throw new Error('unsupported selector');
        }
        return focusVisible;
      },
    });

    await container.trigger('focus');
    expect(wrapper.find('.scale-100').exists()).toBe(true);

    await container.trigger('blur');
    expect(wrapper.find('.scale-100').exists()).toBe(false);

    // A mouse click also focuses the slider, but not "visibly".
    focusVisible = false;
    await container.trigger('focus');
    expect(wrapper.find('.scale-100').exists()).toBe(false);

    // Engines without :focus-visible support still show it.
    focusVisible = 'unsupported';
    await container.trigger('focus');
    expect(wrapper.find('.scale-100').exists()).toBe(true);
  });

  it('handles drawHeatmap return early if no ctx', () => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);
    mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });
});
