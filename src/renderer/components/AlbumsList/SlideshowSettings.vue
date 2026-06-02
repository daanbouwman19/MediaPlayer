<template>
  <div class="shrink-0 p-3 flex flex-col gap-2 glass-panel rounded-xl">
    <!-- Media Type Filters -->
    <div class="flex justify-center bg-black/20 rounded-lg p-1 gap-1">
      <button
        v-for="filter in MEDIA_FILTERS"
        :key="filter"
        class="flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all duration-200"
        :class="
          mediaFilter === filter
            ? 'bg-accent text-button-text shadow-sm'
            : 'text-muted hover:text-accent hover:bg-black/5'
        "
        :aria-pressed="mediaFilter === filter"
        @click="setFilter(filter)"
      >
        {{ filter }}
      </button>
    </div>

    <!-- Toggles -->
    <div class="flex gap-2">
      <label class="flex-1 glass-toggle-btn cursor-pointer group">
        <input
          v-model="pauseTimerOnPlay"
          type="checkbox"
          class="peer sr-only"
        />
        <div
          class="h-full px-3 py-2 rounded-md bg-black/20 border border-white/5 peer-checked:bg-accent/20 peer-checked:border-accent/50 peer-focus-visible:ring-2 peer-focus-visible:ring-accent transition-all flex items-center justify-center gap-2"
        >
          <div
            class="w-3 h-3 rounded-sm border border-muted peer-checked:bg-accent peer-checked:border-accent flex items-center justify-center"
          >
            <svg
              v-if="pauseTimerOnPlay"
              class="w-2.5 h-2.5 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="4"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
          <span
            class="text-[10px] font-medium text-muted group-hover:text-color peer-checked:text-accent-secondary"
            >Pause Timer</span
          >
        </div>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useUIStore } from '../../composables/useUIStore';
import { usePlayerStore } from '../../composables/usePlayerStore';
import { useSlideshow } from '../../composables/useSlideshow';
import { MEDIA_FILTERS, type MediaFilter } from '../../../core/media/constants';

const uiStore = useUIStore();
const playerStore = usePlayerStore();
const slideshow = useSlideshow();

const { mediaFilter } = storeToRefs(uiStore);
const { pauseTimerOnPlay } = storeToRefs(playerStore);

const { reapplyFilter } = slideshow;

const setFilter = async (filter: MediaFilter) => {
  mediaFilter.value = filter;
  await reapplyFilter();
};
</script>
