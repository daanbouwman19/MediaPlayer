<template>
  <li
    class="flex flex-col items-start p-1.5 rounded-md transition-colors duration-200 mb-0.5"
    :class="{
      'bg-accent/15 border-l-2 border-accent': selectionState !== 'none',
      'hover:bg-white/5': selectionState === 'none',
    }"
    :style="{ marginLeft: `${depth * 20}px` }"
  >
    <div
      class="group flex items-center gap-2 w-full text-color hover:text-accent"
    >
      <!-- Toggle Button (Triangle) -->
      <button
        v-if="isFolder"
        class="toggle-button flex items-center justify-center w-6 h-6 rounded hover:bg-black/10 text-muted hover:text-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        :aria-expanded="isOpen"
        :aria-label="isOpen ? `Collapse ${album.name}` : `Expand ${album.name}`"
        @click.stop="toggle"
      >
        <ChevronRightIcon
          class="w-4 h-4 transform transition-transform duration-200"
          :class="{ 'rotate-90': isOpen, 'rotate-0': !isOpen }"
        />
      </button>
      <div v-else class="w-6 h-6 shrink-0"></div>

      <!-- Selection Checkbox -->
      <button
        class="flex items-center justify-center w-5 h-5 rounded hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent shrink-0"
        data-testid="album-checkbox"
        role="checkbox"
        :aria-checked="
          selectionState === 'all'
            ? 'true'
            : selectionState === 'some'
              ? 'mixed'
              : 'false'
        "
        :aria-label="`Select ${album.name}`"
        @click.stop="handleToggleSelection(album, $event)"
      >
        <div
          class="w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors"
          :class="[
            selectionState === 'all'
              ? 'bg-accent border-accent'
              : selectionState === 'some'
                ? 'bg-accent border-accent'
                : 'border-muted hover:border-accent',
          ]"
        >
          <!-- Checkmark -->
          <svg
            v-if="selectionState === 'all'"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="w-2.5 h-2.5 text-white"
          >
            <path
              fill-rule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clip-rule="evenodd"
            />
          </svg>
          <!-- Indeterminate Dash -->
          <div
            v-else-if="selectionState === 'some'"
            class="w-2 h-0.5 bg-white rounded-full"
          ></div>
        </div>
      </button>

      <!-- Main Action Button (Name + Badge) -->
      <button
        class="grow flex items-center gap-2 text-left min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded px-1 -ml-1 transition-colors hover:bg-black/10 cursor-pointer"
        :aria-label="'Play ' + album.name"
        @click="handleClickAlbum(album)"
      >
        <span class="truncate text-sm font-medium select-none">
          {{ album.name }}
        </span>

        <!-- Badge for count -->
        <span
          v-if="totalTextureCount > 0"
          class="shrink-0 bg-accent/10 text-accent text-[10px] font-bold px-1.5 py-0.5 rounded-md"
        >
          {{ totalTextureCount }}
        </span>
      </button>

      <!-- Hover Controls -->
      <div
        class="album-controls flex items-center gap-1 opacity-100 md:opacity-40 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
        @click.stop
      >
        <!-- Play Button for Folder/Album -->
        <button
          class="shrink-0 text-muted hover:text-accent p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="Play Album"
          :aria-label="'Play ' + album.name"
          @click.stop="handleClickAlbum(album)"
        >
          <PlayIcon class="w-4 h-4" />
        </button>

        <!-- Grid Button -->
        <button
          class="shrink-0 text-muted hover:text-accent p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          title="Open in Grid"
          :aria-label="'Open ' + album.name + ' in Grid'"
          @click.stop="handleOpenGrid(album)"
        >
          <GridIcon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Recursive Children -->
    <ul v-if="isFolder && isOpen" class="w-full mt-1">
      <AlbumTree
        v-for="child in album.children"
        :key="child.id"
        :album="child"
        :depth="depth + 1"
        :selection="selection"
        @toggle-selection="$emit('toggleSelection', $event)"
        @album-click="$emit('albumClick', $event)"
      />
    </ul>
  </li>
</template>

<script setup lang="ts">
/**
 * @file Recursive component for album tree.
 * Refactored to use Tailwind CSS and icon-based navigation.
 */
import { ref, computed } from 'vue';
import { countTextures, getAlbumAndChildrenIds } from '../utils/albumUtils';
import { useSlideshow } from '../composables/useSlideshow';
import PlayIcon from './icons/PlayIcon.vue';
import GridIcon from './icons/GridIcon.vue';
import ChevronRightIcon from './icons/ChevronRightIcon.vue';
import type { Album } from '../../core/types';

const props = withDefaults(
  defineProps<{
    album: Album;
    depth?: number;
    selection: { [key: string]: boolean };
  }>(),
  {
    depth: 0,
  },
);

const emit = defineEmits<{
  (e: 'toggleSelection', payload: { album: Album; recursive: boolean }): void;
  (e: 'albumClick', album: Album): void;
}>();

const isOpen = ref(false);
const slideshow = useSlideshow();

const isFolder = computed(() => {
  return props.album.children && props.album.children.length > 0;
});

const toggle = () => {
  isOpen.value = !isOpen.value;
};

const totalTextureCount = computed(() => countTextures(props.album));

const selectionState = computed(() => {
  // We keep this logic in case visuals need to reflect selection state from elsewhere,
  // even if the checkbox is gone, we might highlight valid slideshow selections.
  const allChildrenIds = getAlbumAndChildrenIds(props.album);

  // Bolt Optimization: Use a loop to count selected items instead of `filter` to avoid
  // creating intermediate arrays. This significantly reduces memory pressure during
  // frequent selection updates on large trees.
  let selectedCount = 0;
  const len = allChildrenIds.length;
  for (let i = 0; i < len; i++) {
    if (props.selection[allChildrenIds[i]] === true) {
      selectedCount++;
    }
  }

  if (selectedCount === 0) {
    return 'none';
  }
  if (selectedCount === len) {
    return 'all';
  }
  return 'some';
});

// NOTE: Checkbox emit removed as UI element is removed.
// We can still trigger selection via other means or just rely on 'albumClick' for navigation.

/**
 * Emits an event to toggle the selection of an album.
 * @param album - The album to toggle.
 * @param event - The interaction event.
 */
const handleToggleSelection = (album: Album, event: MouseEvent) => {
  // If shift key is pressed, toggle ONLY the parent (not recursive)
  // Otherwise default to recursive (standard behavior)
  const recursive = !event.shiftKey;
  emit('toggleSelection', { album, recursive });
};

const handleClickAlbum = (album: Album) => {
  emit('albumClick', album);
};

const handleOpenGrid = (album: Album) => {
  slideshow.openAlbumInGrid(album);
};
</script>
