/**
 * @file Locks the app automatically: after a stretch without input (while
 * nothing is playing), when the window is hidden or loses focus, and when
 * the OS session locks or the machine suspends (desktop).
 */
import { onBeforeUnmount, onMounted } from 'vue';
import { api } from '../api';
import { useAuthStore } from './useAuthStore';
import { usePlayerStore } from './usePlayerStore';
import { usePrivacyStore } from './usePrivacyStore';

/** How often the idle time is checked. */
export const IDLE_CHECK_INTERVAL_MS = 10_000;
/** A quick alt-tab and back doesn't lock. */
export const BLUR_GRACE_MS = 1000;

const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
] as const;

export function useAutoLock() {
  const authStore = useAuthStore();
  const playerStore = usePlayerStore();
  const privacyStore = usePrivacyStore();

  let lastActivity = Date.now();
  let idleInterval: ReturnType<typeof setInterval> | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeLockRequest: (() => void) | null = null;

  const isHidden = () => authStore.isLocked || authStore.isCovered;

  /** Watching a video or a running slideshow counts as activity. */
  const isPlaybackActive = () => {
    const video = playerStore.mainVideoElement;
    return (
      (!!video && !video.paused && !video.ended) || playerStore.isTimerRunning
    );
  };

  const lockNow = () => {
    if (isHidden()) return;
    playerStore.haltPlayback();
    void authStore.lock();
  };

  const markActivity = () => {
    lastActivity = Date.now();
  };

  const checkIdle = () => {
    const minutes = privacyStore.autoLockMinutes;
    if (minutes <= 0 || isHidden()) {
      markActivity();
      return;
    }
    if (isPlaybackActive()) {
      markActivity();
      return;
    }
    if (Date.now() - lastActivity >= minutes * 60_000) lockNow();
  };

  const cancelBlurLock = () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
  };

  const scheduleBlurLock = () => {
    if (!privacyStore.lockOnBlur || blurTimer) return;
    blurTimer = setTimeout(() => {
      blurTimer = null;
      lockNow();
    }, BLUR_GRACE_MS);
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') scheduleBlurLock();
    else cancelBlurLock();
  };

  onMounted(() => {
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, markActivity, { passive: true });
    }
    window.addEventListener('blur', scheduleBlurLock);
    window.addEventListener('focus', cancelBlurLock);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    idleInterval = setInterval(checkIdle, IDLE_CHECK_INTERVAL_MS);
    unsubscribeLockRequest = api.onLockRequest(lockNow);
  });

  onBeforeUnmount(() => {
    for (const type of ACTIVITY_EVENTS) {
      window.removeEventListener(type, markActivity);
    }
    window.removeEventListener('blur', scheduleBlurLock);
    window.removeEventListener('focus', cancelBlurLock);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (idleInterval) clearInterval(idleInterval);
    cancelBlurLock();
    unsubscribeLockRequest?.();
  });
}
