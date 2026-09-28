import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';

/**
 * When a video longer than the slideshow timer moves on: `end` lets it play
 * out (the timer waits), `timer` advances when the timer runs out.
 */
export type VideoAdvanceMode = 'end' | 'timer';

const SETTINGS_KEY = 'slideshowSettings';

interface SlideshowSettings {
  timerDuration: number;
  pauseTimerOnPlay: boolean;
  videoAdvance: VideoAdvanceMode;
  randomStart: boolean;
}

const DEFAULT_SETTINGS: SlideshowSettings = {
  timerDuration: 5,
  pauseTimerOnPlay: false,
  videoAdvance: 'end',
  randomStart: false,
};

function loadSettings(): SlideshowSettings {
  let saved: unknown;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  if (typeof saved !== 'object' || saved === null)
    return { ...DEFAULT_SETTINGS };
  const s = saved as Record<string, unknown>;
  return {
    timerDuration:
      typeof s.timerDuration === 'number' &&
      Number.isFinite(s.timerDuration) &&
      s.timerDuration >= 1
        ? s.timerDuration
        : DEFAULT_SETTINGS.timerDuration,
    pauseTimerOnPlay:
      typeof s.pauseTimerOnPlay === 'boolean'
        ? s.pauseTimerOnPlay
        : DEFAULT_SETTINGS.pauseTimerOnPlay,
    videoAdvance:
      s.videoAdvance === 'end' || s.videoAdvance === 'timer'
        ? s.videoAdvance
        : DEFAULT_SETTINGS.videoAdvance,
    randomStart:
      typeof s.randomStart === 'boolean'
        ? s.randomStart
        : DEFAULT_SETTINGS.randomStart,
  };
}

export const usePlayerStore = defineStore('player', () => {
  const settings = loadSettings();
  const isSlideshowActive = ref(false);
  const slideshowTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
  const timerDuration = ref(settings.timerDuration);
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
  const pauseTimerOnPlay = ref(settings.pauseTimerOnPlay);
  const videoAdvance = ref<VideoAdvanceMode>(settings.videoAdvance);
  // Start slideshow videos at a random point instead of the beginning.
  const randomStart = ref(settings.randomStart);

  watch([timerDuration, pauseTimerOnPlay, videoAdvance, randomStart], () => {
    const next: SlideshowSettings = {
      timerDuration: timerDuration.value,
      pauseTimerOnPlay: pauseTimerOnPlay.value,
      videoAdvance: videoAdvance.value,
      randomStart: randomStart.value,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch (e) {
      console.error('Failed to save slideshow settings:', e);
    }
  });
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

  /**
   * Pauses the current video and stops the countdown (panic key, auto-lock).
   * The order matters: stopping after the pause clears the "suspended for
   * video" flag, so the video's pause event can't resume the countdown.
   */
  const haltPlayback = ({ mute = false } = {}) => {
    const video = mainVideoElement.value;
    if (video) {
      video.pause();
      if (mute) {
        isMuted.value = true;
        video.muted = true;
      }
    }
    stopSlideshowTimer();
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
    videoAdvance,
    randomStart,
    mainVideoElement,
    isMuted,
    haltPlayback,
    resetPlayerState,
    startSlideshowTimer,
    stopSlideshowTimer,
    suspendSlideshowTimerForVideo,
    stopSlideshow,
  };
});
