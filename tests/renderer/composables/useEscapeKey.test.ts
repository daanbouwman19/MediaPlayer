import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { ref, defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { useEscapeKey } from '../../../src/renderer/composables/useEscapeKey';

describe('useEscapeKey', () => {
  let addEventListenerSpy: any;
  let removeEventListenerSpy: any;
  let eventHandler: ((e: KeyboardEvent) => void) | null = null;

  beforeEach(() => {
    eventHandler = null;
    addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation((event, handler) => {
        if (event === 'keydown') {
          eventHandler = handler as (e: KeyboardEvent) => void;
        }
      });
    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createTestComponent = (isOpen: any, callback: () => void) =>
    defineComponent({
      setup() {
        useEscapeKey(isOpen, callback);
        return {};
      },
      template: '<div></div>',
    });

  it('should register event listener on mount', () => {
    const isOpen = ref(true);
    const callback = vi.fn();
    const TestComponent = createTestComponent(isOpen, callback);

    mount(TestComponent);

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
  });

  it('should call callback when Escape is pressed and isOpen is true', () => {
    const isOpen = ref(true);
    const callback = vi.fn();
    const TestComponent = createTestComponent(isOpen, callback);

    mount(TestComponent);

    // Simulate Escape key press
    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    if (eventHandler) {
      eventHandler(escapeEvent);
    }

    expect(callback).toHaveBeenCalled();
  });

  it('should NOT call callback when isOpen is false', () => {
    const isOpen = ref(false);
    const callback = vi.fn();
    const TestComponent = createTestComponent(isOpen, callback);

    mount(TestComponent);

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
    if (eventHandler) {
      eventHandler(escapeEvent);
    }

    expect(callback).not.toHaveBeenCalled();
  });

  it('should NOT call callback when a different key is pressed', () => {
    const isOpen = ref(true);
    const callback = vi.fn();
    const TestComponent = createTestComponent(isOpen, callback);

    mount(TestComponent);

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    if (eventHandler) {
      eventHandler(enterEvent);
    }

    expect(callback).not.toHaveBeenCalled();
  });

  it('should remove event listener on unmount', () => {
    const isOpen = ref(true);
    const callback = vi.fn();
    const TestComponent = createTestComponent(isOpen, callback);

    const wrapper = mount(TestComponent);
    wrapper.unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function),
    );
  });
});
