import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export const usePlayerStore = defineStore('player', () => {
  const isSlideshowActive = ref(false);
  const slideshowTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
  const timerDuration = ref(5);
  // The timer state below is written only by the functions in this store, so
  // `isTimerRunning` is true exactly while an auto-advance timeout is pending
  // (or, for the moment its callback runs, being re-armed for the next item).
  const isTimerRunning = ref(false);
  // Set when the countdown was suspended automatically because the current
  // video outlasts it (or "Pause Timer" is on). Only this kind of pause may
  // resume without the user asking; a user pause or a stop clears it.
  const isTimerPausedForVideo = ref(false);
  const timerProgress = ref(0); // Kept for legacy usage, mostly unused now
  const timerStartTime = ref<number | null>(null);
  const timerEndTime = ref<number | null>(null);
  const pauseTimerOnPlay = ref(false);
  // Use shallowRef: the video element is a live DOM node driven imperatively
  // (currentTime, play/pause). Deep reactive proxying adds overhead and can
  // interfere with the native element, and nothing here relies on it.
  const mainVideoElement = shallowRef<HTMLVideoElement | null>(null);
  // Applied to whichever video element is current (MediaDisplay), so the
  // panic key can mute from outside the player and the UI stays in sync.
  const isMuted = ref(false);

  /** Cancels the pending auto-advance timeout and clears its countdown window. */
  const clearSlideshowTimeout = () => {
    if (slideshowTimerId.value !== null) {
      clearTimeout(slideshowTimerId.value);
      slideshowTimerId.value = null;
    }
    timerStartTime.value = null;
    timerEndTime.value = null;
  };

  /**
   * (Re)starts the auto-advance countdown, replacing any pending one.
   * @param durationMs - Time until `onElapsed` runs.
   * @param onElapsed - Called once the countdown ends, with the timeout
   *   cleared but `isTimerRunning` still true. It must either re-arm the timer
   *   (for the next item) or stop it.
   */
  const startSlideshowTimer = (durationMs: number, onElapsed: () => void) => {
    clearSlideshowTimeout();
    isTimerRunning.value = true;
    isTimerPausedForVideo.value = false;
    timerProgress.value = 100;
    const now = Date.now();
    timerStartTime.value = now;
    timerEndTime.value = now + durationMs;
    slideshowTimerId.value = setTimeout(() => {
      slideshowTimerId.value = null;
      clearSlideshowTimeout();
      onElapsed();
    }, durationMs);
  };

  /** Stops the countdown; it only runs again when something starts it. */
  const stopSlideshowTimer = () => {
    clearSlideshowTimeout();
    isTimerRunning.value = false;
    isTimerPausedForVideo.value = false;
  };

  /**
   * Stops a running countdown while the current video plays, remembering that
   * it may resume on its own afterwards. Does nothing if the timer is stopped.
   */
  const suspendSlideshowTimerForVideo = () => {
    if (!isTimerRunning.value) return;
    clearSlideshowTimeout();
    isTimerRunning.value = false;
    isTimerPausedForVideo.value = true;
  };

  /** Ends the slideshow: no countdown, and navigation is disabled. */
  const stopSlideshow = () => {
    stopSlideshowTimer();
    isSlideshowActive.value = false;
  };

  const resetPlayerState = () => {
    stopSlideshow();
  };

  return {
    isSlideshowActive,
    slideshowTimerId,
    timerDuration,
    isTimerRunning,
    isTimerPausedForVideo,
    timerProgress,
    timerStartTime,
    timerEndTime,
    pauseTimerOnPlay,
    mainVideoElement,
    isMuted,
    resetPlayerState,
    startSlideshowTimer,
    stopSlideshowTimer,
    suspendSlideshowTimerForVideo,
    stopSlideshow,
  };
});
