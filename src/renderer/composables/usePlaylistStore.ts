import { defineStore } from 'pinia';
import { reactive, toRefs, computed } from 'vue';
import type { MediaFile } from '../../core/types';

interface PlaylistState {
  history: MediaFile[];
  queue: MediaFile[];
  currentItem: MediaFile | null;
}

const usePiniaPlaylistStore = defineStore('playlist', () => {
  const state = reactive<PlaylistState>({
    history: [],
    queue: [],
    currentItem: null,
  });

  const setQueue = (items: MediaFile[]) => {
    state.queue = [...items];
    state.history = [];
    state.currentItem = null;
  };

  const clearPlaylist = () => {
    state.queue = [];
    state.history = [];
    state.currentItem = null;
  };

  const playNext = (nextItem?: MediaFile) => {
    if (state.currentItem) {
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
    state,
    setQueue,
    clearPlaylist,
    playNext,
    playPrevious,
    hasPrevious,
    hasNext,
  };
});

export function usePlaylistStore() {
  const store = usePiniaPlaylistStore();
  return {
    ...toRefs(store.state),
    state: store.state,
    setQueue: store.setQueue,
    clearPlaylist: store.clearPlaylist,
    playNext: store.playNext,
    playPrevious: store.playPrevious,
    hasPrevious: computed(() => store.hasPrevious),
    hasNext: computed(() => store.hasNext),
  };
}
