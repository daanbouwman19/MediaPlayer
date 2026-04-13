import { reactive, toRefs } from 'vue';

interface PlayerState {
  isSlideshowActive: boolean;
  slideshowTimerId: NodeJS.Timeout | null;
  timerDuration: number;
  isTimerRunning: boolean;
  timerProgress: number;
  playFullVideo: boolean;
  pauseTimerOnPlay: boolean;
  mainVideoElement: HTMLVideoElement | null;
}

const state = reactive<PlayerState>({
  isSlideshowActive: false,
  slideshowTimerId: null,
  timerDuration: 5,
  isTimerRunning: false,
  timerProgress: 0,
  playFullVideo: true,
  pauseTimerOnPlay: false,
  mainVideoElement: null,
});

export function usePlayerStore() {
  const resetPlayerState = () => {
    state.isSlideshowActive = false;
    // We don't reset playFullVideo/timerDuration as they are user preferences
  };

  const stopSlideshow = () => {
    if (state.slideshowTimerId) {
      clearInterval(state.slideshowTimerId);
      state.slideshowTimerId = null;
    }
    state.isTimerRunning = false;
  };

  return {
    ...toRefs(state),
    state,
    resetPlayerState,
    stopSlideshow,
  };
}
