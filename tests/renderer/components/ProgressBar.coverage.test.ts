import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProgressBar from '@/components/ProgressBar.vue';

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

  it('calculateTimeFromEvent returns 0 if no container', () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    const event = { target: document.createElement('div') } as any;
    const result = (wrapper.vm as any).calculateTimeFromEvent(event);
    expect(result).toBe(0);
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
