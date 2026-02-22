<template>
  <div
    class="flex flex-col h-full w-full bg-gray-900 rounded-lg overflow-hidden shadow-lg border border-gray-700"
  >
    <div
      class="flex justify-between items-center p-3 bg-gray-800 border-b border-gray-700 shrink-0"
    >
      <h2 class="text-lg font-semibold text-gray-200">Grid View</h2>
      <button
        class="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-50"
        title="Close Grid View"
        @click="closeGrid"
      >
        Close
      </button>
    </div>

    <!-- Virtual Scroller Container -->
    <div
      ref="scrollerContainer"
      class="media-grid-container p-4 grow overflow-hidden"
    >
      <div
        v-if="allMediaFiles.length === 0"
        class="flex flex-col items-center justify-center h-full text-gray-500 opacity-80"
        role="status"
        aria-live="polite"
      >
        <template v-if="mediaDirectories.length === 0">
          <div class="mb-4 p-4 rounded-full bg-indigo-500/10 text-indigo-400">
            <PlaylistIcon class="w-12 h-12" aria-hidden="true" />
          </div>
          <h2 class="text-xl font-bold text-white mb-2">No Media Sources</h2>
          <p class="text-gray-400 mb-6 max-w-xs text-center text-sm">
            Add a folder to start building your library.
          </p>
          <button
            class="px-6 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors flex items-center gap-2"
            @click="openSourcesModal"
          >
            Add Media Source
          </button>
        </template>
        <template v-else>
          <div class="mb-4 p-4 rounded-full bg-gray-800">
            <PlaylistIcon class="w-12 h-12 opacity-50" aria-hidden="true" />
          </div>
          <p class="text-lg font-medium text-gray-300">No media files found</p>

          <button
            v-if="!isSidebarVisible"
            class="mt-4 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-indigo-300 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium border border-white/10"
            @click="openSidebar"
          >
            <MenuIcon class="w-4 h-4" aria-hidden="true" />
            Open Library
          </button>
          <p v-else class="text-sm mt-2">Choose from the sidebar to begin</p>
        </template>
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
                @click="
                  (item) =>
                    handleItemClick(item, (row as GridRow).startIndex + i - 1)
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
import { useUIStore } from '../composables/useUIStore';
import type { MediaFile } from '../../core/types';
import MediaGridItem from './MediaGridItem.vue';
import VirtualScroller from './VirtualScroller.vue';
import PlaylistIcon from './icons/PlaylistIcon.vue';
import MenuIcon from './icons/MenuIcon.vue';
import {
  GRID_BREAKPOINT_SM,
  GRID_BREAKPOINT_LG,
  GRID_BREAKPOINT_XL,
} from '../../core/constants';

const libraryStore = useLibraryStore();
const playerStore = usePlayerStore();
const uiStore = useUIStore();

const {
  imageExtensionsSet,
  videoExtensionsSet,
  mediaUrlGenerator,
  thumbnailUrlGenerator,
  mediaDirectories,
} = libraryStore;

const { isSidebarVisible, isSourcesModalVisible } = uiStore;

const openSourcesModal = () => {
  isSourcesModalVisible.value = true;
};

const openSidebar = () => {
  isSidebarVisible.value = true;
};

// Reactive reference to the full list from state
const allMediaFiles = computed(() => uiStore.state.gridMediaFiles);

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

// Chunk items into rows for the scroller
const chunkedItems = computed<GridRow[]>(() => {
  const total = allMediaFiles.value.length;
  const cols = columnCount.value;
  const rows: GridRow[] = [];

  const rowCount = Math.ceil(total / cols);

  for (let i = 0; i < rowCount; i++) {
    rows.push({
      id: `row-${i * cols}`,
      startIndex: i * cols,
    });
  }
  return rows;
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
});

/**
 * Handlers for interactions
 */
const handleItemClick = async (item: MediaFile, index: number) => {
  if (failedImagePaths.has(item.path)) {
    // Optional: Prevent clicking broken images or let it handle error in player?
    // For now, let's allow trying to play/view it, maybe player handles it.
  }

  // When clicking an item, we pass the FULL list to the player
  // Optimization: Use toRaw() to avoid Proxy overhead when slicing large arrays.
  // slice() creates a shallow copy, which is what we need.
  playerStore.state.displayedMediaFiles = toRaw(allMediaFiles.value).slice();

  // Optimization: We now pass the index directly, avoiding an O(N) findIndex scan
  playerStore.state.currentMediaIndex = index;
  playerStore.state.currentMediaItem = item;
  uiStore.state.viewMode = 'player';
  playerStore.state.isSlideshowActive = true;
  playerStore.state.isTimerRunning = false;
};

const closeGrid = () => {
  uiStore.state.viewMode = 'player';
};
</script>
