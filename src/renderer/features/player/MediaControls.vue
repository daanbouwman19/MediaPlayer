<template>
  <Teleport to="body" :disabled="isDesktop">
    <!-- On mobile the bar is teleported above everything, so hide it while the
         full-screen sidebar overlay is open. -->
    <div
      v-show="isDesktop || !isSidebarVisible"
      v-bind="$attrs"
      class="fixed md:absolute bottom-0 left-0 w-full flex flex-col items-center pointer-events-none z-100"
    >
      <div
        ref="controlsBarRef"
        class="controls-bar w-full flex flex-col justify-end items-center transition-transform-opacity duration-500 ease-in-out will-change-transform bg-linear-to-t from-black/90 via-black/60 to-transparent pt-12 pb-6 pointer-events-auto"
        :class="[{ 'translate-y-full opacity-0': !isControlsVisible }]"
        :style="containerPaddingStyle"
      >
        <!-- Progress Bar -->
        <div
          v-if="!isImage && currentMediaItem"
          class="w-full mb-4 px-2 md:px-0 max-w-7xl mx-auto"
        >
          <ProgressBar
            :current-time="currentTime"
            :duration="duration"
            :heatmap="heatmapData"
            :watched-segments="watchedSegments"
            @seek="$emit('seek', $event)"
            @scrub-start="$emit('scrub-start')"
            @scrub-end="$emit('scrub-end')"
          />
        </div>

        <!-- Heatmap Loading Indicator -->
        <Transition name="fade">
          <div
            v-if="isHeatmapLoading"
            class="flex absolute top-[-60px] right-4 z-50 bg-black/70 text-white text-xs px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-xl pointer-events-none shadow-2xl items-center gap-2"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <div class="loader-spinner"></div>
            <span class="font-medium tracking-wide antialiased"
              >Analyzing Scene... {{ heatmapProgress }}%</span
            >
          </div>
        </Transition>

        <!-- Buttons Row -->
        <div
          class="flex flex-nowrap justify-center items-center w-full"
          :class="gapClass"
        >
          <!-- Previous Button -->
          <button
            :disabled="isPreviousDisabled"
            class="group transition-all duration-200 hover:bg-(--accent-color) disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0"
            :class="navButtonClass"
            :title="
              isPreviousDisabled ? 'No previous media' : 'Previous media (Z)'
            "
            :aria-label="
              isPreviousDisabled ? 'No previous media' : 'Previous media (Z)'
            "
            @click="$emit('previous')"
          >
            <ChevronLeftIcon class="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <!-- Next Button -->
          <button
            :disabled="!canNavigate"
            class="group transition-all duration-200 hover:bg-(--accent-color) disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0"
            :class="navButtonClass"
            title="Next media (X)"
            aria-label="Next media (X)"
            @click="$emit('next')"
          >
            <ChevronRightIcon class="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <!-- Separator for Rating -->
          <div
            v-if="!isImage && currentMediaItem && showStars"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0"
          ></div>

          <!-- Rating -->
          <div
            v-if="currentMediaItem && showStars"
            class="flex gap-0.5"
            @mouseleave="hoverRating = null"
          >
            <button
              v-for="star in 5"
              :key="star"
              class="transition-all duration-200 transform hover:scale-110 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:rounded-sm"
              :class="
                (
                  hoverRating !== null
                    ? hoverRating >= star
                    : (currentMediaItem?.rating || 0) >= star
                )
                  ? 'text-(--accent-color)'
                  : 'text-white/30 hover:text-white/70'
              "
              :aria-label="`Rate ${star} ${star === 1 ? 'star' : 'stars'}${
                (currentMediaItem?.rating || 0) === star
                  ? ', current rating'
                  : ''
              }`"
              :aria-pressed="(currentMediaItem?.rating || 0) === star"
              :title="`Rate ${star} ${star === 1 ? 'star' : 'stars'}`"
              @mouseenter="hoverRating = star"
              @click="$emit('set-rating', star)"
            >
              <StarIcon class="w-4 h-4 md:w-5 md:h-5" />
            </button>
          </div>

          <!-- Separator for Controls -->
          <div
            v-if="currentMediaItem && showStars"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0 hidden sm:block"
          ></div>

          <!-- Play/Pause -->
          <button
            v-if="!isImage && currentMediaItem"
            class="play-pause-button p-1.5 md:p-2 rounded-full text-white transition-all duration-200 hover:bg-(--accent-color) hover:text-button-text focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0"
            :aria-label="
              isPlaying ? 'Pause video (Space)' : 'Play video (Space)'
            "
            :title="isPlaying ? 'Pause video (Space)' : 'Play video (Space)'"
            @click="$emit('toggle-play')"
          >
            <PauseIcon v-if="isPlaying" class="w-5 h-5 md:w-6 md:h-6" />
            <PlayIcon v-else class="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <!-- Separator -->
          <div
            v-if="!isImage && currentMediaItem && !isNarrowView"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0"
          ></div>

          <!-- Mute/Unmute -->
          <button
            v-if="!isImage && currentMediaItem"
            class="p-1.5 md:p-2 rounded-full text-white transition-all duration-200 hover:bg-(--accent-color) hover:text-button-text focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0"
            :title="isMuted ? 'Unmute' : 'Mute'"
            :aria-label="isMuted ? 'Unmute audio' : 'Mute audio'"
            @click="$emit('toggle-mute')"
          >
            <VolumeOffIcon v-if="isMuted" class="w-5 h-5 md:w-6 md:h-6" />
            <VolumeUpIcon v-else class="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <!-- Separator -->
          <div
            v-if="!isImage && currentMediaItem && !isNarrowView"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0"
          ></div>

          <!-- VR Mode -->
          <button
            v-if="!isImage && currentMediaItem"
            class="p-1.5 md:p-2 rounded-full transition-all duration-200 hover:bg-(--accent-color) hover:text-button-text focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0 hidden sm:block"
            :class="
              isVrMode ? 'bg-(--accent-color) text-button-text' : 'text-white'
            "
            title="Toggle VR Mode (180°)"
            aria-label="Toggle VR Mode"
            :aria-pressed="isVrMode"
            @click="$emit('toggle-vr')"
          >
            <VRIcon class="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <!-- Separator -->
          <div
            v-if="!isImage && currentMediaItem"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0 hidden sm:block"
          ></div>

          <!-- VLC -->
          <button
            v-if="!isImage && currentMediaItem"
            class="vlc-button p-1.5 md:p-2 rounded-full text-white transition-all duration-200 hover:bg-(--accent-color) hover:text-button-text focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0 hidden sm:block"
            :class="{ 'opacity-50 cursor-wait': isOpeningVlc }"
            :disabled="isOpeningVlc"
            :title="isOpeningVlc ? 'Opening VLC...' : 'Open in VLC'"
            :aria-label="isOpeningVlc ? 'Opening VLC...' : 'Open in VLC'"
            @click="$emit('open-in-vlc')"
          >
            <SpinnerIcon
              v-if="isOpeningVlc"
              class="animate-spin w-5 h-5 md:w-6 md:h-6"
            />
            <VlcIcon v-else class="w-5 h-5 md:w-6 md:h-6" />
          </button>

          <!-- Separator -->
          <div
            v-if="!isImage && currentMediaItem"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0 hidden sm:block"
          ></div>

          <!-- Time Display In-Pill (Desktop/Tablet) -->
          <button
            v-if="!isImage && currentMediaItem && showTime"
            type="button"
            class="text-[10px] md:text-xs font-mono text-white/80 min-w-[60px] md:min-w-[80px] text-center hover:text-white cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded px-1"
            :title="
              timeDisplayMode === 'total'
                ? 'Show remaining time'
                : 'Show total duration'
            "
            data-testid="time-display"
            @click="toggleTimeDisplay"
          >
            {{ formattedTime }}
          </button>

          <!-- Separator -->
          <div
            v-if="!isImage && currentMediaItem"
            class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0 hidden sm:block"
            :class="{ 'hidden!': isNarrowView }"
          ></div>

          <template v-if="!isImage && currentMediaItem">
            <!-- Shortcuts -->
            <button
              class="p-1.5 md:p-2 rounded-full text-white transition-all duration-200 hover:bg-(--accent-color) hover:text-button-text focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0 hidden sm:block"
              title="Keyboard Shortcuts (?)"
              aria-label="Keyboard Shortcuts"
              @click="$emit('open-shortcuts')"
            >
              <HelpIcon class="w-5 h-5 md:w-6 md:h-6" />
            </button>

            <!-- Separator -->
            <div
              class="w-px h-6 md:h-8 bg-white/10 mx-0.5 md:mx-2 shrink-0 hidden sm:block"
              :class="{ 'hidden!': isNarrowView }"
            ></div>
          </template>

          <!-- Fullscreen -->
          <button
            v-if="!isImage && currentMediaItem"
            class="p-1.5 md:p-2 rounded-full text-white transition-all duration-200 hover:bg-(--accent-color) hover:text-button-text focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none shrink-0"
            title="Toggle Fullscreen"
            aria-label="Toggle Fullscreen"
            @click="$emit('toggle-fullscreen')"
          >
            <ExpandIcon class="w-5 h-5 md:w-6 md:h-6" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import VlcIcon from '@/components/atoms/icons/VlcIcon.vue';
import SpinnerIcon from '@/components/atoms/icons/SpinnerIcon.vue';
import VRIcon from '@/components/atoms/icons/VRIcon.vue';
import ChevronLeftIcon from '@/components/atoms/icons/ChevronLeftIcon.vue';
import ChevronRightIcon from '@/components/atoms/icons/ChevronRightIcon.vue';
import PlayIcon from '@/components/atoms/icons/PlayIcon.vue';
import PauseIcon from '@/components/atoms/icons/PauseIcon.vue';
import VolumeUpIcon from '@/components/atoms/icons/VolumeUpIcon.vue';
import VolumeOffIcon from '@/components/atoms/icons/VolumeOffIcon.vue';
import ExpandIcon from '@/components/atoms/icons/ExpandIcon.vue';
import StarIcon from '@/components/atoms/icons/StarIcon.vue';
import HelpIcon from '@/components/atoms/icons/HelpIcon.vue';
import ProgressBar from '@/components/atoms/ProgressBar.vue';
import type { MediaFile, HeatmapData } from '../../../core/media/types';
import type { WatchedSegment } from '@/utils/watchedSegments';
import { useUIStore } from '@/composables/useUIStore';
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatTime } from '@/utils/timeUtils';
import { api } from '@/api/index';
import { isHeatmapBusyError } from '../../../core/media/analysis/heatmap-errors';

defineOptions({
  inheritAttrs: false,
});

const props = withDefaults(
  defineProps<{
    currentMediaItem: MediaFile | null;
    isPlaying: boolean;
    canNavigate: boolean;
    isControlsVisible: boolean;
    isImage: boolean;
    isVrMode?: boolean;
    currentTime?: number;
    duration?: number;
    canGoPrevious?: boolean;
    isOpeningVlc?: boolean;
    isMuted?: boolean;
    /** Played ranges of the current item; owned and persisted by MediaDisplay. */
    watchedSegments?: WatchedSegment[];
  }>(),
  {
    canGoPrevious: true,
    currentTime: 0,
    duration: 0,
    isOpeningVlc: false,
    watchedSegments: () => [],
  },
);

const { isSidebarVisible } = storeToRefs(useUIStore());

// Hover logic for rating stars
const hoverRating = ref<number | null>(null);

const MD_BREAKPOINT = 768;

// Detect "Desktop" (medium screen) vs "Mobile" (small screen)
const isDesktop = ref(window.innerWidth >= MD_BREAKPOINT);
const isLandscape = ref(window.innerWidth > window.innerHeight);

const handleResize = () => {
  isDesktop.value = window.innerWidth >= MD_BREAKPOINT;
  isLandscape.value = window.innerWidth > window.innerHeight;
};

onMounted(() => {
  window.addEventListener('resize', handleResize);

  if (controlsBarRef.value) {
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        containerWidth.value = entries[0].contentRect.width;
      }
    });
    observer.observe(controlsBarRef.value);

    // Initial set
    containerWidth.value = controlsBarRef.value.getBoundingClientRect().width;

    // Cleanup observer on unmount
    onUnmounted(() => {
      observer.disconnect();
    });
  }
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});

// Move time to bubble if we are on mobile OR the sidebar is open
const isNarrowView = computed(() => !isDesktop.value || isSidebarVisible.value);

const isPreviousDisabled = computed(
  () => !props.canNavigate || !props.canGoPrevious,
);

const navButtonClass = computed(() => {
  // Desktop - Large Pill (if space permits)
  if (isDesktop.value && containerWidth.value > 640) {
    // Note: 'nav-button' usually adds padding, but we define specifics here for safety
    return 'px-5 py-2 rounded-lg text-white hover:text-button-text font-bold uppercase tracking-wider text-sm shadow-md';
  }

  // Mobile Portrait - Medium Pill
  if (!isLandscape.value) {
    return 'px-4 py-1.5 rounded-lg text-white hover:text-button-text font-bold uppercase tracking-wide text-xs shadow-sm';
  }

  // Mobile Landscape - Compact Circle
  return 'p-1.5 rounded-full text-white hover:text-button-text';
});

// Dynamic Gap for controls container
const gapClass = computed(() => {
  if (isDesktop.value && containerWidth.value > 640) {
    return 'gap-4'; // Standard desktop
  }
  if (!isLandscape.value) {
    return 'gap-6'; // Portrait Mobile
  }
  return 'gap-3'; // Landscape Mobile
});

// Container Padding Style based on Orientation + Safe Area
const containerPaddingStyle = computed(() => {
  // Landscape -> 48px, Portrait -> 24px + extra for navbar safe area
  // Increased base padding to avoid clipping with gesture bar
  const basePadding = isLandscape.value ? '3rem' : '2.5rem';
  return {
    paddingLeft: `max(${basePadding}, env(safe-area-inset-left))`,
    paddingRight: `max(${basePadding}, env(safe-area-inset-right))`,
    paddingBottom: `calc(max(1.5rem, env(safe-area-inset-bottom)) + 12px)`, // Extra 12px for safety
  };
});

// Dynamic Responsiveness
const controlsBarRef = ref<HTMLElement | null>(null);
const containerWidth = ref(0);

// Thresholds
const SHOW_STARS_THRESHOLD = 650; // Stars disappear below this
const SHOW_TIME_THRESHOLD = 450; // Time disappears below this

const showStars = computed(() => {
  // Always show on "desktop" unless very constrained.
  // On mobile (< 768), stars are typically hidden by design choice.
  if (!isDesktop.value) return false;

  return containerWidth.value > SHOW_STARS_THRESHOLD;
});

const showTime = computed(() => {
  return containerWidth.value > SHOW_TIME_THRESHOLD;
});

const timeDisplayMode = ref<'total' | 'remaining'>('total');

const formattedTime = computed(() => {
  const currentTime = props.currentTime || 0;
  const duration = props.duration || 0;
  const current = formatTime(currentTime);

  if (timeDisplayMode.value === 'remaining') {
    const remaining = Math.max(0, duration - currentTime);
    const remainingStr = formatTime(remaining);
    return `${current} / -${remainingStr}`;
  }

  const total = formatTime(duration);
  return `${current} / ${total}`;
});

const toggleTimeDisplay = () => {
  timeDisplayMode.value =
    timeDisplayMode.value === 'total' ? 'remaining' : 'total';
};

const heatmapData = ref<HeatmapData | null>(null);
const isHeatmapLoading = ref(false);
const heatmapProgress = ref(0);
let fetchTimeout: ReturnType<typeof setTimeout> | null = null;

// Request fewer points for smoother look
const HEATMAP_POINTS = 100;
const HEATMAP_POLL_INTERVAL_MS = 2000;
// Busy or dropped requests are retried while the item stays on screen
// (the analysis keeps running on the backend in the meantime).
const HEATMAP_MAX_RETRIES = 60;
const HEATMAP_RECONNECT_DELAY_MS = 1000;
const HEATMAP_BUSY_RETRY_DELAY_MS = 5000;
const HEATMAP_MAX_RETRY_DELAY_MS = 30000;

// Owned by the current item's fetch. Aborting it cancels the backend request
// and turns that fetch's late results into no-ops.
let heatmapController: AbortController | null = null;

const cancelHeatmapFetch = () => {
  heatmapController?.abort();
  heatmapController = null;
  isHeatmapLoading.value = false;
  heatmapProgress.value = 0;
};

const waitForHeatmapRetry = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });

const loadHeatmap = async (filePath: string, signal: AbortSignal) => {
  isHeatmapLoading.value = true;
  heatmapProgress.value = 0;

  const pollProgress = async () => {
    try {
      const progress = await api.getHeatmapProgress(filePath);
      if (!signal.aborted && progress !== null) {
        heatmapProgress.value = progress;
      }
    } catch (err) {
      console.warn('[MediaControls] Progress poll failed', err);
    }
  };
  // Local to this fetch, so another fetch can never stop it.
  const pollInterval = setInterval(() => {
    void pollProgress();
  }, HEATMAP_POLL_INTERVAL_MS);

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await api.getHeatmap(filePath, HEATMAP_POINTS, {
          signal,
        });
        if (!signal.aborted) heatmapData.value = result;
        return;
      } catch (err) {
        if (signal.aborted) return;
        const busy = isHeatmapBusyError(err);
        // A TypeError is a dropped connection (fetch); the analysis may
        // still be running, so rejoin it.
        if (
          (!busy && !(err instanceof TypeError)) ||
          attempt >= HEATMAP_MAX_RETRIES
        ) {
          console.warn('[MediaControls] Failed to fetch heatmap', err);
          return;
        }
        const delay = busy
          ? Math.min(
              HEATMAP_MAX_RETRY_DELAY_MS,
              HEATMAP_BUSY_RETRY_DELAY_MS * 2 ** Math.min(attempt, 3),
            )
          : HEATMAP_RECONNECT_DELAY_MS;
        await waitForHeatmapRetry(delay, signal);
        if (signal.aborted) return;
      }
    }
  } finally {
    clearInterval(pollInterval);
    if (!signal.aborted) isHeatmapLoading.value = false;
  }
};

const fetchHeatmap = () => {
  // Never show (or keep loading) the previous item's heatmap.
  cancelHeatmapFetch();
  heatmapData.value = null;

  // Clear previous pending fetch
  if (fetchTimeout) {
    clearTimeout(fetchTimeout);
    fetchTimeout = null;
  }

  if (!props.currentMediaItem) return;

  const filePath = props.currentMediaItem.path;
  // Images have no progress bar, so their heatmap would never be shown.
  const wantsHeatmap = !props.isImage;
  const controller = new AbortController();
  heatmapController = controller;

  // Debounce: Wait 1 second before starting heavy analysis
  fetchTimeout = setTimeout(async () => {
    fetchTimeout = null;
    try {
      if (wantsHeatmap) await loadHeatmap(filePath, controller.signal);
    } catch (e) {
      console.warn('Failed to fetch heatmap', e);
    }
  }, 1000);
};

onUnmounted(() => {
  cancelHeatmapFetch();
  if (fetchTimeout) clearTimeout(fetchTimeout);
});

watch(() => props.currentMediaItem, fetchHeatmap, { immediate: true });

defineEmits<{
  (e: 'previous'): void;
  (e: 'next'): void;
  (e: 'toggle-play'): void;
  (e: 'toggle-mute'): void;
  (e: 'open-in-vlc'): void;
  (e: 'set-rating', star: number): void;
  (e: 'toggle-vr'): void;
  (e: 'toggle-fullscreen'): void;
  (e: 'seek', time: number): void;
  (e: 'scrub-start'): void;
  (e: 'scrub-end'): void;
  (e: 'open-shortcuts'): void;
}>();
</script>

<style scoped>
.loader-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
