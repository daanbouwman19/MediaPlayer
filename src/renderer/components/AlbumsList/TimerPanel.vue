<template>
  <div
    class="shrink-0 p-3 flex items-end gap-3 relative overflow-hidden glass-panel rounded-xl"
  >
    <div class="flex flex-col gap-1 grow">
      <label
        for="timer-input"
        class="text-[10px] font-bold text-gray-500 uppercase tracking-widest"
        >Timer Duration</label
      >
      <div class="relative">
        <input
          id="timer-input"
          v-model.number="timerDuration"
          type="number"
          min="1"
          step="1"
          placeholder="5"
          aria-label="Slideshow timer duration in seconds"
          class="w-full glass-input text-sm pl-3 pr-10 py-2 rounded-lg no-spinner"
          @blur="timerDuration = Math.max(1, Math.floor(timerDuration) || 5)"
        />
        <span
          class="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none"
          >sec</span
        >
      </div>
    </div>

    <!-- Shuffle All Sources -->
    <button
      class="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg text-muted hover:text-accent hover:bg-black/5 transition-colors"
      title="Shuffle All Sources"
      aria-label="Shuffle All Sources"
      @click="slideshow.startSlideshow()"
    >
      <ShuffleIcon class="w-5 h-5" />
    </button>

    <!-- Primary Play Action -->
    <button
      class="timer-button h-10 w-14 shrink-0 flex items-center justify-center rounded-lg glass-button-primary"
      data-testid="timer-button"
      :title="isTimerRunning ? 'Pause Slideshow' : 'Start/Resume Slideshow'"
      :aria-label="
        isTimerRunning ? 'Pause Slideshow' : 'Start/Resume Slideshow'
      "
      @click="handleToggleTimer"
    >
      <PauseIcon v-if="isTimerRunning" class="w-6 h-6 fill-current" />
      <PlayIcon v-else class="w-6 h-6 fill-current ml-1" />
    </button>

    <!-- Global Progress Bar (if running, inside timer pane bottom) -->
    <div
      v-if="isTimerRunning"
      class="absolute bottom-0 left-0 w-full h-1 bg-gray-800"
      data-testid="slideshow-progress"
    >
      <div
        class="h-full bg-accent transition-all duration-100 ease-linear"
        :style="{ width: `${timerProgress}%` }"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { usePlayerStore } from '../../composables/usePlayerStore';
import { useSlideshow } from '../../composables/useSlideshow';
import ShuffleIcon from '../icons/ShuffleIcon.vue';
import PauseIcon from '../icons/PauseIcon.vue';
import PlayIcon from '../icons/PlayIcon.vue';

const playerStore = usePlayerStore();
const slideshow = useSlideshow();

const { timerDuration, isTimerRunning, timerProgress, isSlideshowActive } =
  storeToRefs(playerStore);

const handleToggleTimer = () => {
  if (!isSlideshowActive.value) {
    slideshow.startSlideshow();
  }
  slideshow.toggleSlideshowTimer();
};
</script>

<style scoped>
/* Chrome, Safari, Edge, Opera */
.no-spinner::-webkit-outer-spin-button,
.no-spinner::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox */
.no-spinner {
  appearance: textfield;
  -moz-appearance: textfield;
}
</style>
