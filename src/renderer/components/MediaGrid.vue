<template>
  <div
    class="flex flex-col h-full w-full glass-panel md:rounded-xl overflow-hidden shadow-lg"
  >
    <div
      class="flex justify-between items-center p-3 bg-black/5 border-b border-white/10 shrink-0"
    >
      <h2 class="text-lg font-semibold text-color">Grid View</h2>
      <button
        class="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500"
        title="Close Grid View"
        aria-label="Close Grid View"
        @click="closeGrid"
      >
        Close
      </button>
    </div>

    <!-- Selection action bar — only visible when items are selected -->
    <div
      v-if="selectedPaths.size > 0"
      class="flex items-center gap-2 px-3 py-2 bg-black/10 border-b border-white/10 shrink-0"
    >
      <span class="text-sm text-muted grow"
        >{{ selectedPaths.size }} selected</span
      >
      <button
        v-if="selectedHaveTranscode"
        class="glass-button text-sm px-3 py-1.5 rounded text-red-400 hover:bg-red-400/10 transition-colors duration-200"
        title="Remove pre-transcoded HLS for selected files"
        @click="handleClearTranscode"
      >
        Clear HLS
      </button>
      <button
        class="glass-button-primary text-sm px-3 py-1.5 rounded"
        title="Pre-transcode selected files"
        @click="handlePreTranscode"
      >
        Pre-transcode
      </button>
      <button
        class="glass-button text-sm px-3 py-1.5 rounded text-muted"
        title="Clear selection"
        @click="clearSelection"
      >
        Deselect
      </button>
    </div>

    <!-- Virtual Scroller Container -->
    <div
      ref="scrollerContainer"
      class="media-grid-container p-4 grow overflow-hidden"
    >
      <div
        v-if="!allMediaFiles || allMediaFiles.length === 0"
        class="flex flex-col items-center justify-center h-full text-muted opacity-80"
        role="status"
        aria-live="polite"
      >
        <div class="mb-4 p-4 rounded-full bg-black/10 text-muted">
          <PlaylistIcon class="w-12 h-12 opacity-50" aria-hidden="true" />
        </div>
        <p class="text-lg font-medium">No media files found</p>
        <p class="text-sm">Try selecting a different album</p>
      </div>

      <VirtualScroller
        v-else
        :key="columnCount"
        class="h-full custom-scrollbar"
        :items="chunkedItems"
        :item-size="rowHeight"
        key-field="id"
      >
        <template #default="{ item: row }">
          <div class="grid w-full h-full" :style="gridStyle">
            <template v-for="i in columnCount" :key="i">
              <!-- Check if item exists -->
              <MediaGridItem
                v-if="allMediaFiles[(row as GridRow).startIndex + i - 1]"
                :item="allMediaFiles[(row as GridRow).startIndex + i - 1]"
                :image-extensions-set="imageExtensionsSet"
                :video-extensions-set="videoExtensionsSet"
                :media-url-generator="mediaUrlGenerator"
                :thumbnail-url-generator="thumbnailUrlGenerator"
                :failed-image-paths="failedImagePaths"
                :is-selected="
                  selectedPaths.has(
                    allMediaFiles[(row as GridRow).startIndex + i - 1].path,
                  )
                "
                :transcode-status="
                  jobStatusMap.get(
                    allMediaFiles[(row as GridRow).startIndex + i - 1].path,
                  )
                "
                @click="
                  (item, event) =>
                    handleItemClick(
                      item,
                      (row as GridRow).startIndex + i - 1,
                      event,
                    )
                "
              />
            </template>
          </div>
        </template>
      </VirtualScroller>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
/**
 * @file Displays a grid of media items (images and videos).
 * Supports hover-to-preview for videos and click-to-play functionality.
 * Uses VirtualScroller for performance on large albums.
 */
import {
  ref,
  onMounted,
  onUnmounted,
  computed,
  watch,
  reactive,
  toRaw,
} from 'vue';
import { useLibraryStore } from '../composables/useLibraryStore';
import { usePlayerStore } from '../composables/usePlayerStore';
import { usePlaylistStore } from '../composables/usePlaylistStore';
import { useUIStore } from '../composables/useUIStore';
import { useTranscodeQueue } from '../composables/useTranscodeQueue';
import type { MediaFile } from '../../core/media/types';
import MediaGridItem from './MediaGridItem.vue';
import VirtualScroller from './VirtualScroller.vue';
import PlaylistIcon from './icons/PlaylistIcon.vue';
import {
  GRID_BREAKPOINT_SM,
  GRID_BREAKPOINT_LG,
  GRID_BREAKPOINT_XL,
} from '../../core/media/constants';

const libraryStore = useLibraryStore();
const playerStore = usePlayerStore();
const playlistStore = usePlaylistStore();
const uiStore = useUIStore();

const {
  imageExtensionsSet,
  videoExtensionsSet,
  mediaUrlGenerator,
  thumbnailUrlGenerator,
} = storeToRefs(libraryStore);

// Reactive reference to the full list from state
const allMediaFiles = computed(() => uiStore.gridMediaFiles);

// Extend Record<string, unknown> to satisfy VirtualScroller props
interface GridRow extends Record<string, unknown> {
  id: string;
  startIndex: number;
}

const scrollerContainer = ref<HTMLElement | null>(null);
const containerWidth = ref(1024); // Default fallback
const MIN_CONTAINER_WIDTH = 320;

// -- Grid Dimensions Logic --
const columnCount = computed(() => {
  const w = containerWidth.value;
  if (w < GRID_BREAKPOINT_SM) return 2; // grid-cols-2
  if (w < GRID_BREAKPOINT_LG) return 3; // sm:grid-cols-3 and md:grid-cols-3
  if (w < GRID_BREAKPOINT_XL) return 4; // lg:grid-cols-4
  return 5; // xl:grid-cols-5
});

const gap = computed(() => {
  // Matching gap-2 (8px) and md:gap-4 (16px)
  return containerWidth.value < 768 ? 8 : 16;
});

// Calculate item width (square)
const itemWidth = computed(() => {
  const PADDING_PX = 16; // p-4 = 1rem = 16px
  const totalGapWidth = gap.value * (columnCount.value - 1);
  const availableWidth = containerWidth.value - PADDING_PX * 2;
  // Use floor to ensure we fit in the container without sub-pixel overflow
  return Math.floor((availableWidth - totalGapWidth) / columnCount.value);
});

// Calculate row height to maintain square aspect ratio for items
const rowHeight = computed(() => {
  // Add gap to height because VirtualScroller packs rows tightly, we simulate gap with marginBottom
  return itemWidth.value + gap.value;
});

// Update styles to use explicit height
// We set the height of the content row to exactly itemWidth.
// The VirtualScroller item-size (rowHeight) is itemWidth + gap.
// This leaves exactly 'gap' pixels of empty space at the bottom of each row.
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${columnCount.value}, minmax(0, 1fr))`,
  gap: `${gap.value}px`,
  height: `${itemWidth.value}px`,
}));

const failedImagePaths = reactive(new Set<string>());
const selectedPaths = ref<Set<string>>(new Set());
const lastClickedIndex = ref<number>(-1);
const { jobStatusMap, startPolling, stopPolling, addJobs, cancelJob } =
  useTranscodeQueue();

const selectedHaveTranscode = computed(() => {
  for (const path of selectedPaths.value) {
    if (jobStatusMap.value.has(path)) return true;
  }
  return false;
});

// Chunk items into rows for the scroller
const chunkedItems = computed<GridRow[]>(() => {
  const chunks: GridRow[] = [];
  const items = allMediaFiles.value;
  if (!items) return chunks;
  const cols = columnCount.value;
  const rowCount = Math.ceil(items.length / cols);

  for (let i = 0; i < rowCount; i++) {
    chunks.push({
      id: `row-${i * cols}`,
      startIndex: i * cols,
    });
  }
  return chunks;
});

// Resize Observer
let resizeObserver: ResizeObserver | null = null;
let resizeFrame: number;

const setupResizeObserver = () => {
  if (scrollerContainer.value && !resizeObserver) {
    resizeObserver = new ResizeObserver((entries) => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        for (const entry of entries) {
          if (entry.contentBoxSize) {
            containerWidth.value = Math.max(
              MIN_CONTAINER_WIDTH,
              entry.contentRect.width,
            );
          }
        }
      });
    });
    resizeObserver.observe(scrollerContainer.value);
  }
};

onMounted(() => {
  // Initial setup attempt
  setupResizeObserver();
  startPolling();
});

// Watch for the container appearing (e.g. when items are loaded)
watch(scrollerContainer, () => {
  setupResizeObserver();
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (resizeFrame) {
    cancelAnimationFrame(resizeFrame);
  }
  stopPolling();
});

/**
 * Handlers for interactions
 */
const handleItemClick = async (
  item: MediaFile,
  index: number,
  event: MouseEvent,
) => {
  const isModifier = event.ctrlKey || event.metaKey;
  const isShift = event.shiftKey;

  if (isModifier) {
    // Toggle selection
    const next = new Set(selectedPaths.value);
    if (next.has(item.path)) {
      next.delete(item.path);
    } else {
      next.add(item.path);
      lastClickedIndex.value = index;
    }
    selectedPaths.value = next;
    return;
  }

  if (isShift && lastClickedIndex.value >= 0) {
    // Range select
    const lo = Math.min(lastClickedIndex.value, index);
    const hi = Math.max(lastClickedIndex.value, index);
    const next = new Set(selectedPaths.value);
    const items = allMediaFiles.value;
    for (let i = lo; i <= hi; i++) {
      if (items[i]) next.add(items[i].path);
    }
    selectedPaths.value = next;
    return;
  }

  // Plain click: clear selection and play
  selectedPaths.value = new Set();
  lastClickedIndex.value = index;

  const mediaList = toRaw(allMediaFiles.value).slice();
  playlistStore.setQueue(mediaList.slice(index + 1));
  playlistStore.playNext(item);

  uiStore.viewMode = 'player';
  playerStore.isSlideshowActive = true;
  playerStore.isTimerRunning = false;
};

const handlePreTranscode = async () => {
  const paths = [...selectedPaths.value];
  selectedPaths.value = new Set();
  await addJobs(paths);
};

const handleClearTranscode = async () => {
  const paths = [...selectedPaths.value].filter((p) =>
    jobStatusMap.value.has(p),
  );
  selectedPaths.value = new Set();
  await Promise.all(paths.map((p) => cancelJob(p)));
};

const clearSelection = () => {
  selectedPaths.value = new Set();
};

const closeGrid = () => {
  uiStore.viewMode = 'player';
};
</script>
