<template>
  <div class="mb-4">
    <div class="flex items-center justify-between px-3 mb-2">
      <button
        class="flex items-center gap-1.5 text-xs font-bold text-muted uppercase tracking-wider focus:outline-none hover:text-accent cursor-pointer"
        aria-label="Toggle Queue Panel"
        @click="isOpen = !isOpen"
      >
        <component
          :is="isOpen ? ArrowUpIcon : ListIcon"
          class="w-3.5 h-3.5"
          aria-hidden="true"
        />
        <span>Playback Queue ({{ queue.length }})</span>
      </button>

      <button
        v-if="queue.length > 0"
        class="text-xs text-muted hover:text-red-400 font-semibold focus:outline-none cursor-pointer"
        title="Clear entire queue"
        @click="clearPlaylist"
      >
        Clear
      </button>
    </div>

    <transition name="collapse">
      <div v-if="isOpen && queue.length > 0">
        <ul class="space-y-1 px-1">
          <li
            v-for="(item, index) in displayedQueue"
            :key="entryKeys[index]"
            class="group relative flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 border border-white/5 cursor-grab active:cursor-grabbing hover:bg-white/10 hover:border-white/10 transition-all select-none"
            :class="{
              'opacity-50 border-dashed border-accent': draggedIndex === index,
              'border-t-2 border-t-accent bg-accent/10':
                dragOverIndex === index &&
                draggedIndex !== null &&
                draggedIndex > index,
              'border-b-2 border-b-accent bg-accent/10':
                dragOverIndex === index &&
                draggedIndex !== null &&
                draggedIndex < index,
            }"
            draggable="true"
            @dragstart="handleDragStart($event, item, index)"
            @dragover.prevent="handleDragOver(item)"
            @dragenter.prevent="handleDragEnter(item)"
            @dragleave="handleDragLeave(item)"
            @drop="handleDrop($event, item)"
            @dragend="handleDragEnd"
          >
            <!-- Left side: Drag handle + Thumbnail/Play indicator + Track info -->
            <div class="flex items-center gap-2 truncate min-w-0 mr-2">
              <!-- Tiny Drag Handle Icon -->
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-3.5 h-3.5 text-muted opacity-50 group-hover:opacity-100"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2.5"
                  d="M4 8h16M4 16h16"
                />
              </svg>

              <!-- Play button / thumbnail -->
              <button
                class="flex items-center gap-1.5 truncate text-sm text-color group-hover:text-accent text-left focus:outline-none cursor-pointer min-w-0 font-medium"
                :aria-label="'Play track ' + item.name"
                @click="playTrack(item)"
              >
                <span class="truncate">{{ item.name }}</span>
              </button>
            </div>

            <!-- Right side: Remove single item button -->
            <button
              class="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-red-400 p-0.5 rounded transition-opacity focus:outline-none cursor-pointer"
              title="Remove from queue"
              :aria-label="'Remove ' + item.name + ' from queue'"
              @click.stop="removeFromQueue(item)"
            >
              <DeleteIcon class="w-3.5 h-3.5" />
            </button>
          </li>
        </ul>

        <!-- Limit / Show more panel -->
        <div
          v-if="queue.length > displayLimit"
          class="mt-2.5 flex items-center justify-between px-3 py-1.5 rounded-lg bg-white/5 border border-white/5"
        >
          <span class="text-[11px] text-muted font-medium">
            ... and {{ queue.length - displayLimit }} more tracks
          </span>
          <div class="flex gap-2">
            <button
              class="text-[11px] text-accent hover:underline font-bold focus:outline-none cursor-pointer"
              @click="displayLimit += 100"
            >
              Show 100 more
            </button>
            <span class="text-muted text-[11px] select-none">|</span>
            <button
              class="text-[11px] text-accent hover:underline font-bold focus:outline-none cursor-pointer"
              @click="displayLimit = queue.length"
            >
              Show all
            </button>
          </div>
        </div>
      </div>
      <div v-else-if="isOpen" class="px-3 py-2 text-xs text-muted italic">
        Queue is empty. Select an album or play next.
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, shallowRef, computed, toRaw } from 'vue';
import { storeToRefs } from 'pinia';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useSlideshow } from '@/composables/useSlideshow';
import ArrowUpIcon from '@/components/atoms/icons/ArrowUpIcon.vue';
import ListIcon from '@/components/atoms/icons/ListIcon.vue';
import DeleteIcon from '@/components/atoms/icons/DeleteIcon.vue';
import type { MediaFile } from '../../../../core/media/types';

const playlistStore = usePlaylistStore();
const slideshow = useSlideshow();
const { queue } = storeToRefs(playlistStore);

const isOpen = ref(true);
const displayLimit = ref(50);

const displayedQueue = computed(() => queue.value.slice(0, displayLimit.value));

// Keys follow the entry, not its position: when the slideshow advances,
// playNext() shifts the queue, and index-based keys would re-create every row
// (tearing down a drag in progress). Repeats of a path get a counter suffix.
const entryKeys = computed(() => {
  const seen = new Map<string, number>();
  const keys: string[] = [];
  for (const item of displayedQueue.value) {
    const count = seen.get(item.path) ?? 0;
    seen.set(item.path, count + 1);
    keys.push(count === 0 ? item.path : `${item.path}#${count}`);
  }
  return keys;
});

/** The entry's current position in the queue, or null if it is gone. */
const indexInQueue = (item: MediaFile | null): number | null => {
  if (!item) return null;
  const index = queue.value.indexOf(item);
  return index === -1 ? null : index;
};

// The drag state holds the entries themselves and resolves their positions
// when needed, because the queue can shift between dragstart and drop.
const draggedItem = shallowRef<MediaFile | null>(null);
const dragOverItem = shallowRef<MediaFile | null>(null);
const draggedIndex = computed(() => indexInQueue(draggedItem.value));
const dragOverIndex = computed(() => indexInQueue(dragOverItem.value));

const clearPlaylist = () => {
  playlistStore.clearPlaylist();
};

const playTrack = (item: MediaFile) => {
  void slideshow.playQueuedItem(item);
};

const removeFromQueue = (item: MediaFile) => {
  const index = indexInQueue(item);
  if (index !== null) playlistStore.queue.splice(index, 1);
};

/* Drag and Drop event handlers */
const handleDragStart = (event: DragEvent, item: MediaFile, index: number) => {
  draggedItem.value = item;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
};

const handleDragOver = (item: MediaFile) => {
  dragOverItem.value = item;
};

const handleDragEnter = (item: MediaFile) => {
  dragOverItem.value = item;
};

const handleDragLeave = (item: MediaFile) => {
  if (dragOverItem.value && toRaw(dragOverItem.value) === toRaw(item)) {
    dragOverItem.value = null;
  }
};

const handleDrop = (event: DragEvent, target: MediaFile) => {
  event.preventDefault();
  const from = draggedIndex.value;
  const to = indexInQueue(target);
  if (from !== null && to !== null && from !== to) {
    playlistStore.reorderQueue(from, to);
  }
  resetDragState();
};

const handleDragEnd = () => {
  resetDragState();
};

const resetDragState = () => {
  draggedItem.value = null;
  dragOverItem.value = null;
};
</script>

<style scoped>
.collapse-enter-active,
.collapse-leave-active {
  transition:
    max-height 0.3s ease,
    opacity 0.2s ease;
  max-height: 3000px;
  overflow: hidden;
}

.collapse-enter-from,
.collapse-leave-to {
  max-height: 0;
  opacity: 0;
}
</style>
