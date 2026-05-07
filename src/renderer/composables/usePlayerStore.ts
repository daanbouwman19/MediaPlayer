import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

interface PlayerState {
  isSlideshowActive: boolean;
  slideshowTimerId: NodeJS.Timeout | null;
  timerDuration: number;
  isTimerRunning: boolean;
  timerProgress: number;
  pauseTimerOnPlay: boolean;
  mainVideoElement: HTMLVideoElement | null;
}

const usePiniaPlayerStore = defineStore('player', () => {
  const state = reactive<PlayerState>({
    isSlideshowActive: false,
    slideshowTimerId: null,
    timerDuration: 5,
    isTimerRunning: false,
    timerProgress: 0,
    pauseTimerOnPlay: false,
    mainVideoElement: null,
  });

  const resetPlayerState = () => {
    state.isSlideshowActive = false;
  };

  const stopSlideshow = () => {
    if (state.slideshowTimerId) {
      clearInterval(state.slideshowTimerId);
      state.slideshowTimerId = null;
    }
    state.isTimerRunning = false;
  };

  return { state, resetPlayerState, stopSlideshow };
});

export function usePlayerStore() {
  const store = usePiniaPlayerStore();
  return {
    ...toRefs(store.state),
    state: store.state,
    resetPlayerState: store.resetPlayerState,
    stopSlideshow: store.stopSlideshow,
  };
}
