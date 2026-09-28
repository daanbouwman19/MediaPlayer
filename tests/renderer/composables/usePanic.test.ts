import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const { mockMinimize, mockLock } = vi.hoisted(() => ({
  mockMinimize: vi.fn(),
  mockLock: vi.fn(),
}));

vi.mock('@/api', () => ({ api: { minimizeWindow: mockMinimize } }));

import { usePanic } from '@/composables/usePanic';
import { useAuthStore } from '@/composables/useAuthStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePrivacyStore } from '@/composables/usePrivacyStore';

const Host = defineComponent({
  setup() {
    usePanic();
    return () => h('div', [h('input', { id: 'field' })]);
  },
});

const press = (
  target: EventTarget,
  code: string,
  init: KeyboardEventInit = {},
) => {
  const event = new KeyboardEvent('keydown', {
    code,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

describe('usePanic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setActivePinia(createPinia());
    useAuthStore().lock = mockLock;
  });

  const fakeVideo = () => {
    const calls: string[] = [];
    const video = {
      muted: false,
      pause: vi.fn(() => calls.push('pause')),
    };
    const player = usePlayerStore();
    const stop = player.stopSlideshowTimer;
    player.stopSlideshowTimer = vi.fn(() => {
      calls.push('stopTimer');
      stop();
    });
    player.mainVideoElement = video as unknown as HTMLVideoElement;
    return { video, calls, player };
  };

  it('pauses and mutes, then stops the timer and locks', () => {
    const { video, calls, player } = fakeVideo();
    const wrapper = mount(Host, { attachTo: document.body });

    const event = press(document.body, 'Backquote');

    expect(video.pause).toHaveBeenCalled();
    expect(video.muted).toBe(true);
    expect(player.isMuted).toBe(true);
    expect(calls).toEqual(['pause', 'stopTimer']);
    expect(mockLock).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(mockMinimize).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('works without a video and minimizes when enabled', () => {
    usePrivacyStore().panicMinimize = true;
    const wrapper = mount(Host, { attachTo: document.body });
    press(document.body, 'Backquote');
    expect(mockLock).toHaveBeenCalled();
    expect(mockMinimize).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('fires from inside inputs and ahead of other handlers', () => {
    const wrapper = mount(Host, { attachTo: document.body });
    const other = vi.fn();
    document.addEventListener('keydown', other);

    press(wrapper.find('#field').element, 'Backquote');

    expect(mockLock).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
    document.removeEventListener('keydown', other);
    wrapper.unmount();
  });

  it('uses the configured key', () => {
    usePrivacyStore().panicKey = 'KeyP';
    const wrapper = mount(Host, { attachTo: document.body });
    press(document.body, 'Backquote');
    expect(mockLock).not.toHaveBeenCalled();
    press(document.body, 'KeyP');
    expect(mockLock).toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([
    ['repeat', { repeat: true }],
    ['IME composition', { isComposing: true }],
  ])('ignores %s', (_name, init) => {
    const wrapper = mount(Host, { attachTo: document.body });
    press(document.body, 'Backquote', init);
    expect(mockLock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('ignores the key while capturing a new one or when already locked', () => {
    const wrapper = mount(Host, { attachTo: document.body });
    usePrivacyStore().isCapturingPanicKey = true;
    press(document.body, 'Backquote');
    usePrivacyStore().isCapturingPanicKey = false;
    useAuthStore().isLocked = true;
    const event = press(document.body, 'Backquote');
    expect(mockLock).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    wrapper.unmount();
  });

  it('removes its listener on unmount', () => {
    const wrapper = mount(Host, { attachTo: document.body });
    wrapper.unmount();
    press(document.body, 'Backquote');
    expect(mockLock).not.toHaveBeenCalled();
  });
});
