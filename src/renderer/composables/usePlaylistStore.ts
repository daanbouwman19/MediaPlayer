import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { MediaFile } from '../../core/types';

export const usePlaylistStore = defineStore('playlist', () => {
  const history = ref<MediaFile[]>([]);
  const queue = ref<MediaFile[]>([]);
  const currentItem = ref<MediaFile | null>(null);

  const setQueue = (items: MediaFile[]) => {
    queue.value = [...items];
    history.value = [];
    currentItem.value = null;
  };

  const clearPlaylist = () => {
    queue.value = [];
    history.value = [];
    currentItem.value = null;
  };

  const playNext = (nextItem?: MediaFile) => {
    if (currentItem.value) {
      if (history.value.length >= 100) {
        history.value.shift();
      }
      history.value.push(currentItem.value);
    }

    if (nextItem) {
      currentItem.value = nextItem;
    } else if (queue.value.length > 0) {
      currentItem.value = queue.value.shift() || null;
    } else {
      currentItem.value = null;
    }
  };

  const playPrevious = () => {
    if (history.value.length === 0) return;

    if (currentItem.value) {
      queue.value.unshift(currentItem.value);
    }

    currentItem.value = history.value.pop() || null;
  };

  const hasPrevious = computed(() => history.value.length > 0);
  const hasNext = computed(() => queue.value.length > 0);

  return {
    history,
    queue,
    currentItem,
    setQueue,
    clearPlaylist,
    playNext,
    playPrevious,
    hasPrevious,
    hasNext,
  };
});
