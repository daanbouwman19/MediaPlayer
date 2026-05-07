import { defineStore } from 'pinia';
import { reactive, computed, watch, toRefs } from 'vue';
import type {
  Album,
  MediaDirectory,
  SmartPlaylist,
  MediaFile,
} from '../../core/types';
import { api } from '../api';

interface LibraryState {
  isScanning: boolean;
  allAlbums: Album[];
  mediaDirectories: MediaDirectory[];
  supportedExtensions: { images: string[]; videos: string[]; all: string[] };
  smartPlaylists: SmartPlaylist[];
  historyMedia: MediaFile[];
  albumsSelectedForSlideshow: { [albumName: string]: boolean };
  globalMediaPoolForSelection: MediaFile[];
  totalMediaInPool: number;
  mediaUrlGenerator: ((path: string) => string) | null;
  thumbnailUrlGenerator: ((path: string) => string) | null;
}

export const usePiniaLibraryStore = defineStore('library', () => {
  const state = reactive<LibraryState>({
    isScanning: false,
    allAlbums: [],
    mediaDirectories: [],
    supportedExtensions: { images: [], videos: [], all: [] },
    smartPlaylists: [],
    historyMedia: [],
    albumsSelectedForSlideshow: {},
    globalMediaPoolForSelection: [],
    totalMediaInPool: 0,
    mediaUrlGenerator: null,
    thumbnailUrlGenerator: null,
  });

  const imageExtensionsSet = computed(
    () => new Set(state.supportedExtensions.images),
  );
  const videoExtensionsSet = computed(
    () => new Set(state.supportedExtensions.videos),
  );

  watch(
    () => state.albumsSelectedForSlideshow,
    (newSelection: { [key: string]: boolean }) => {
      try {
        localStorage.setItem('albumSelection', JSON.stringify(newSelection));
      } catch (e) {
        console.error('Failed to save album selection:', e);
      }
    },
    { deep: true },
  );

  const selectAllAlbumsRecursively = (albums: Album[]) => {
    const newSelection = { ...state.albumsSelectedForSlideshow };
    const stack = [...albums];
    while (stack.length > 0) {
      const album = stack.pop()!;
      newSelection[album.id] = true;
      if (album.children && album.children.length > 0) {
        for (let i = album.children.length - 1; i >= 0; i--) {
          stack.push(album.children[i]);
        }
      }
    }
    state.albumsSelectedForSlideshow = newSelection;
  };

  const fetchHistory = async (limit = 50) => {
    try {
      const items = await api.getRecentlyPlayed(limit);
      state.historyMedia = items.map((item) => {
        const name = item.file_path.split(/[\/\\]/).pop() || item.file_path;
        return {
          name,
          path: item.file_path,
          viewCount: item.view_count || 0,
          rating: item.rating || 0,
          lastViewed: item.last_viewed
            ? new Date(item.last_viewed).getTime()
            : undefined,
          duration: item.duration || 0,
          playbackPosition: item.playback_position || 0,
        };
      });
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
  };

  const loadInitialData = async () => {
    try {
      const [albums, directories, playlists, extensions, mediaGen, thumbGen] =
        await Promise.all([
          api.getAlbumsWithViewCounts(),
          api.getMediaDirectories(),
          api.getSmartPlaylists(),
          api.getSupportedExtensions(),
          api.getMediaUrlGenerator(),
          api.getThumbnailUrlGenerator(),
        ]);

      state.allAlbums = albums;
      state.mediaDirectories = directories;
      state.smartPlaylists = playlists;
      state.supportedExtensions = extensions;
      state.mediaUrlGenerator = mediaGen;
      state.thumbnailUrlGenerator = thumbGen;

      const savedSelection = localStorage.getItem('albumSelection');
      if (savedSelection) {
        try {
          state.albumsSelectedForSlideshow = JSON.parse(savedSelection);
        } catch (e) {
          console.error('Failed to parse saved album selection:', e);
          selectAllAlbumsRecursively(state.allAlbums);
        }
      } else {
        selectAllAlbumsRecursively(state.allAlbums);
      }
    } catch (error) {
      console.error('[useLibraryStore] Error during initial load:', error);
    }
  };

  const clearMediaPool = () => {
    state.globalMediaPoolForSelection = [];
  };

  const resetLibraryState = () => {
    state.globalMediaPoolForSelection = [];
    state.albumsSelectedForSlideshow = {};
    state.historyMedia = [];
  };

  return {
    state,
    imageExtensionsSet,
    videoExtensionsSet,
    loadInitialData,
    selectAllAlbumsRecursively,
    fetchHistory,
    clearMediaPool,
    resetLibraryState,
  };
});

export const setupPersistenceWatcher = () => {
  // Provided for backward compatibility if any test explicitly imports it
  // The actual watcher is now initialized when the pinia store is created.
};

export function useLibraryStore() {
  const store = usePiniaLibraryStore();
  return {
    ...toRefs(store.state),
    state: store.state,
    imageExtensionsSet: computed(() => store.imageExtensionsSet),
    videoExtensionsSet: computed(() => store.videoExtensionsSet),
    loadInitialData: store.loadInitialData,
    selectAllAlbumsRecursively: store.selectAllAlbumsRecursively,
    fetchHistory: store.fetchHistory,
    clearMediaPool: store.clearMediaPool,
    resetLibraryState: store.resetLibraryState,
  };
}
