import { defineStore } from 'pinia';
import { ref } from 'vue';

export const usePlayerStore = defineStore('player', () => {
  const isSlideshowActive = ref(false);
  const slideshowTimerId = ref<NodeJS.Timeout | null>(null);
  const timerDuration = ref(5);
  const isTimerRunning = ref(false);
  const timerProgress = ref(0);
  const pauseTimerOnPlay = ref(false);
  const mainVideoElement = ref<HTMLVideoElement | null>(null);

  const resetPlayerState = () => {
    isSlideshowActive.value = false;
  };

  const stopSlideshow = () => {
    if (slideshowTimerId.value) {
      clearInterval(slideshowTimerId.value);
      slideshowTimerId.value = null;
    }
    isTimerRunning.value = false;
  };

  return {
    isSlideshowActive,
    slideshowTimerId,
    timerDuration,
    isTimerRunning,
    timerProgress,
    pauseTimerOnPlay,
    mainVideoElement,
    resetPlayerState,
    stopSlideshow,
  };
});
