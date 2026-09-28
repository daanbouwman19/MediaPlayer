import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';

const { lockRequest, mockUnsubscribe } = vi.hoisted(() => ({
  lockRequest: { callback: null as null | (() => void) },
  mockUnsubscribe: vi.fn(),
}));

vi.mock('@/api', () => ({
  api: {
    onLockRequest: vi.fn((cb: () => void) => {
      lockRequest.callback = cb;
      return mockUnsubscribe;
    }),
  },
}));

import {
  BLUR_GRACE_MS,
  IDLE_CHECK_INTERVAL_MS,
  useAutoLock,
} from '@/composables/useAutoLock';
import { useAuthStore } from '@/composables/useAuthStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePrivacyStore } from '@/composables/usePrivacyStore';

const Host = defineComponent({
  setup() {
    useAutoLock();
    return () => h('div');
  },
});

const MINUTE = 60_000;

describe('useAutoLock', () => {
  let lock: ReturnType<typeof vi.fn<() => Promise<void>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    setActivePinia(createPinia());
    const auth = useAuthStore();
    lock = vi.fn(() => {
      auth.isCovered = true;
      return Promise.resolve();
    });
    auth.lock = lock;
    mockUnsubscribe.mockClear();
    lockRequest.callback = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks after the idle time', () => {
    usePrivacyStore().autoLockMinutes = 2;
    const wrapper = mount(Host);

    vi.advanceTimersByTime(2 * MINUTE - IDLE_CHECK_INTERVAL_MS);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2 * IDLE_CHECK_INTERVAL_MS);
    expect(lock).toHaveBeenCalledTimes(1);

    // Already hidden: no second lock.
    vi.advanceTimersByTime(5 * MINUTE);
    expect(lock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('input resets the idle time', () => {
    usePrivacyStore().autoLockMinutes = 1;
    const wrapper = mount(Host);

    vi.advanceTimersByTime(50_000);
    window.dispatchEvent(new Event('pointermove'));
    vi.advanceTimersByTime(50_000);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(lock).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not lock while a video plays or the slideshow runs', () => {
    usePrivacyStore().autoLockMinutes = 1;
    const player = usePlayerStore();
    player.mainVideoElement = {
      paused: false,
      ended: false,
      pause: vi.fn(),
    } as unknown as HTMLVideoElement;
    const wrapper = mount(Host);

    vi.advanceTimersByTime(5 * MINUTE);
    expect(lock).not.toHaveBeenCalled();

    player.mainVideoElement = null;
    player.startSlideshowTimer(10 * MINUTE, () => {});
    vi.advanceTimersByTime(5 * MINUTE);
    expect(lock).not.toHaveBeenCalled();

    player.stopSlideshowTimer();
    vi.advanceTimersByTime(MINUTE + IDLE_CHECK_INTERVAL_MS);
    expect(lock).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('never idle-locks when turned off', () => {
    const wrapper = mount(Host);
    vi.advanceTimersByTime(60 * MINUTE);
    expect(lock).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  describe('lock on blur', () => {
    it('locks after the grace period', () => {
      usePrivacyStore().lockOnBlur = true;
      const wrapper = mount(Host);

      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(BLUR_GRACE_MS - 1);
      expect(lock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(lock).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('a quick return cancels it', () => {
      usePrivacyStore().lockOnBlur = true;
      const wrapper = mount(Host);

      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(BLUR_GRACE_MS * 2);
      expect(lock).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('reacts to the page being hidden and shown', () => {
      usePrivacyStore().lockOnBlur = true;
      const wrapper = mount(Host);
      const visibility = vi.spyOn(document, 'visibilityState', 'get');

      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      visibility.mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(BLUR_GRACE_MS * 2);
      expect(lock).not.toHaveBeenCalled();

      visibility.mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(BLUR_GRACE_MS);
      expect(lock).toHaveBeenCalled();
      visibility.mockRestore();
      wrapper.unmount();
    });

    it('is off by default', () => {
      const wrapper = mount(Host);
      window.dispatchEvent(new Event('blur'));
      vi.advanceTimersByTime(BLUR_GRACE_MS * 2);
      expect(lock).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });

  it('locks on an OS lock request and pauses playback', () => {
    const pause = vi.fn();
    usePlayerStore().mainVideoElement = {
      paused: false,
      pause,
    } as unknown as HTMLVideoElement;
    const wrapper = mount(Host);

    lockRequest.callback?.();

    expect(pause).toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
    wrapper.unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it('stops listening on unmount', () => {
    const privacy = usePrivacyStore();
    privacy.autoLockMinutes = 1;
    privacy.lockOnBlur = true;
    const wrapper = mount(Host);
    window.dispatchEvent(new Event('blur'));
    wrapper.unmount();

    vi.advanceTimersByTime(10 * MINUTE);
    expect(lock).not.toHaveBeenCalled();
  });
});
