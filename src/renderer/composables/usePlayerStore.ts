import { reactive, toRefs } from 'vue';
import type { MediaFile } from '../../core/types';

interface PlayerState {
  isSlideshowActive: boolean;
  slideshowTimerId: NodeJS.Timeout | null;
  timerDuration: number;
  isTimerRunning: boolean;
  timerProgress: number;
  playFullVideo: boolean;
  pauseTimerOnPlay: boolean;
  displayedMediaFiles: MediaFile[];
  currentMediaItem: MediaFile | null;
  currentMediaIndex: number;
  mainVideoElement: HTMLVideoElement | null;
  isLoading: boolean;
}

const state = reactive<PlayerState>({
  isSlideshowActive: false,
  slideshowTimerId: null,
  timerDuration: 5,
  isTimerRunning: false,
  timerProgress: 0,
  playFullVideo: true,
  pauseTimerOnPlay: false,
  displayedMediaFiles: [],
  currentMediaItem: null,
  currentMediaIndex: -1,
  mainVideoElement: null,
  isLoading: false,
});

export function usePlayerStore() {
  const resetPlayerState = () => {
    state.isSlideshowActive = false;
    state.displayedMediaFiles = [];
    state.currentMediaIndex = -1;
    state.currentMediaItem = null;
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
