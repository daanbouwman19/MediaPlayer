<template>
  <div class="shrink-0 p-3 flex flex-col gap-2 glass-panel rounded-xl">
    <!-- Media Type Filters -->
    <div class="flex bg-text-color/5 rounded-lg p-1 gap-1">
      <button
        v-for="filter in MEDIA_FILTERS"
        :key="filter"
        class="flex-1 min-w-0 px-2 py-1.5 text-xs font-semibold rounded-md transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink"
        :class="
          mediaFilter === filter
            ? 'bg-accent text-button-text shadow-sm'
            : 'text-muted hover:text-color hover:bg-text-color/5'
        "
        :aria-pressed="mediaFilter === filter"
        @click="setFilter(filter)"
      >
        {{ filter }}
      </button>
    </div>

    <!-- Toggles -->
    <div class="grid grid-cols-3 gap-1.5">
      <label
        v-for="toggle in toggles"
        :key="toggle.label"
        class="min-w-0 cursor-pointer"
        :title="toggle.title"
      >
        <input
          v-model="toggle.model.value"
          type="checkbox"
          class="peer sr-only"
        />
        <span
          class="h-full px-1 py-1.5 rounded-md border flex items-center justify-center text-center text-[11px] font-medium leading-tight whitespace-nowrap transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent-ink"
          :class="
            toggle.model.value
              ? 'bg-accent/15 border-accent text-color'
              : 'bg-text-color/5 border-transparent text-muted hover:bg-text-color/10 hover:text-color'
          "
          >{{ toggle.label }}</span
        >
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useUIStore } from '@/composables/useUIStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useSlideshow } from '@/composables/useSlideshow';
import {
  MEDIA_FILTERS,
  type MediaFilter,
} from '../../../../core/media/constants';

const uiStore = useUIStore();
const playerStore = usePlayerStore();
const slideshow = useSlideshow();

const { mediaFilter } = storeToRefs(uiStore);
const { pauseTimerOnPlay, videoAdvance, randomStart } =
  storeToRefs(playerStore);

// Checkbox view of the advance mode: checked cuts long videos off when the
// timer runs out.
const cutLongVideos = computed({
  get: () => videoAdvance.value === 'timer',
  set: (value: boolean) => {
    videoAdvance.value = value ? 'timer' : 'end';
  },
});

const toggles = [
  {
    label: 'Pause Timer',
    title: 'Pause the slideshow timer while a video plays',
    model: pauseTimerOnPlay,
  },
  {
    label: 'Cut Videos',
    title: 'Advance when the timer runs out, even mid-video',
    model: cutLongVideos,
  },
  {
    label: 'Random Start',
    title: 'Start slideshow videos at a random point',
    model: randomStart,
  },
];

const { reapplyFilter } = slideshow;

const setFilter = async (filter: MediaFilter) => {
  mediaFilter.value = filter;
  await reapplyFilter();
};
</script>
