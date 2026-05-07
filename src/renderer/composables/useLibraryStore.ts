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

// Computed sets for O(1) extension lookups
const imageExtensionsSet = computed(
  () => new Set(state.supportedExtensions.images),
);
const videoExtensionsSet = computed(
  () => new Set(state.supportedExtensions.videos),
);

let isWatcherInitialized = false;

export const setupPersistenceWatcher = () => {
  if (isWatcherInitialized) return;
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
  isWatcherInitialized = true;
};

// Start watcher immediately
setupPersistenceWatcher();

export function useLibraryStore() {
  /**
   * Recursively selects all albums in the provided list.
   * Optimized to minimize reactive updates by building the selection map first
   * and assigning it in a single operation.
   * Also uses iterative traversal to avoid stack overflow on deep trees.
   * @param albums - The list of albums to select.
   */
  const selectAllAlbumsRecursively = (albums: Album[]) => {
    // Start with current selection to preserve existing keys if this is additive
    // (though usually 'selectAll' implies setting state for the provided tree)
    // The previous implementation was additive.
    // However, since we are assigning to state.albumsSelectedForSlideshow, we should decide if we replace or merge.
    // The previous implementation:
    // state.albumsSelectedForSlideshow[album.id] = true;
    // This preserves existing keys that are NOT in the new list.
    // So we should clone the current state.

    // If we are selecting *all* albums available (state.allAlbums), we might as well just create a new object if we want to clean up.
    // But let's stick to the additive behavior to be safe and consistent with previous logic.
    const newSelection = { ...state.albumsSelectedForSlideshow };

    // Iterative stack-based traversal
    const stack = [...albums];
    while (stack.length > 0) {
      const album = stack.pop()!;
      newSelection[album.id] = true;

      if (album.children && album.children.length > 0) {
        // Push children in reverse order to maintain traversal order (though order doesn't matter for set)
        for (let i = album.children.length - 1; i >= 0; i--) {
          stack.push(album.children[i]);
        }
      }
    }

    // Single reactive update
    state.albumsSelectedForSlideshow = newSelection;
  };

  const fetchHistory = async (limit = 50) => {
    try {
      const items = await api.getRecentlyPlayed(limit);
      // API returns items ordered by last_viewed DESC (most recent first)
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
      // Bolt Optimization: Parallelize independent fetches for better startup performance
      // and cache URL generators to avoid repeated IPC calls in components.
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

  return {
    ...toRefs(state),
    state, // Expose raw state for direct access if needed
    imageExtensionsSet,
    videoExtensionsSet,
    loadInitialData,
    selectAllAlbumsRecursively,
    fetchHistory,
    clearMediaPool: () => {
      state.globalMediaPoolForSelection = [];
    },
    resetLibraryState: () => {
      state.globalMediaPoolForSelection = [];
      state.albumsSelectedForSlideshow = {};
      state.historyMedia = [];
    },
  };
}
