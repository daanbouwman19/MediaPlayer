import { reactive, toRefs, computed } from 'vue';
import type { MediaFile } from '../../core/types';

interface PlaylistState {
  history: MediaFile[];
  queue: MediaFile[];
  currentItem: MediaFile | null;
}

const state = reactive<PlaylistState>({
  history: [],
  queue: [],
  currentItem: null,
});

export function usePlaylistStore() {
  /**
   * Replaces the entire queue and resets history.
   * Useful when opening an album or starting a fresh slideshow.
   */
  const setQueue = (items: MediaFile[]) => {
    state.queue = [...items];
    state.history = [];
    state.currentItem = null;
  };

  /**
   * Clears the current item, history, and queue.
   */
  const clearPlaylist = () => {
    state.queue = [];
    state.history = [];
    state.currentItem = null;
  };

  /**
   * Advances to the next item automatically.
   * If a specific item is provided, it becomes current.
   * Otherwise, pops from the front of the queue.
   * Pushes the previous currentItem into history.
   */
  const playNext = (nextItem?: MediaFile) => {
    if (state.currentItem) {
      // Keep history capped at 100 items to prevent memory leaks
      if (state.history.length >= 100) {
        state.history.shift();
      }
      state.history.push(state.currentItem);
    }

    if (nextItem) {
      state.currentItem = nextItem;
    } else if (state.queue.length > 0) {
      state.currentItem = state.queue.shift() || null;
    } else {
      state.currentItem = null;
    }
  };

  /**
   * Goes back to the previous item in history.
   * Pushes the current item into the front of the queue so it can be played again.
   */
  const playPrevious = () => {
    if (state.history.length === 0) return;

    if (state.currentItem) {
      state.queue.unshift(state.currentItem);
    }

    state.currentItem = state.history.pop() || null;
  };

  const hasPrevious = computed(() => state.history.length > 0);
  const hasNext = computed(() => state.queue.length > 0);

  return {
    ...toRefs(state),
    state,
    setQueue,
    clearPlaylist,
    playNext,
    playPrevious,
    hasPrevious,
    hasNext,
  };
}
