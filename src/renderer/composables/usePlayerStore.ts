import { defineStore } from 'pinia';
import { ref, shallowRef } from 'vue';

export const usePlayerStore = defineStore('player', () => {
  const isSlideshowActive = ref(false);
  const slideshowTimerId = ref<ReturnType<typeof setTimeout> | null>(null);
  const timerDuration = ref(5);
  const isTimerRunning = ref(false);
  const timerProgress = ref(0); // Kept for legacy usage, mostly unused now
  const timerStartTime = ref<number | null>(null);
  const timerEndTime = ref<number | null>(null);
  const pauseTimerOnPlay = ref(false);
  // Use shallowRef: the video element is a live DOM node driven imperatively
  // (currentTime, play/pause). Deep reactive proxying adds overhead and can
  // interfere with the native element, and nothing here relies on it.
  const mainVideoElement = shallowRef<HTMLVideoElement | null>(null);

  const resetPlayerState = () => {
    isSlideshowActive.value = false;
  };

  const stopSlideshow = () => {
    if (slideshowTimerId.value) {
      clearTimeout(slideshowTimerId.value);
      slideshowTimerId.value = null;
    }
    isTimerRunning.value = false;
    timerStartTime.value = null;
    timerEndTime.value = null;
  };

  return {
    isSlideshowActive,
    slideshowTimerId,
    timerDuration,
    isTimerRunning,
    timerProgress,
    timerStartTime,
    timerEndTime,
    pauseTimerOnPlay,
    mainVideoElement,
    resetPlayerState,
    stopSlideshow,
  };
});
