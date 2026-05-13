import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type {
  Album,
  MediaDirectory,
  SmartPlaylist,
  MediaFile,
} from '../../core/types';
import { api } from '../api';

export const useLibraryStore = defineStore('library', () => {
  const isScanning = ref(false);
  const allAlbums = ref<Album[]>([]);
  const mediaDirectories = ref<MediaDirectory[]>([]);
  const supportedExtensions = ref<{
    images: string[];
    videos: string[];
    all: string[];
  }>({
    images: [],
    videos: [],
    all: [],
  });
  const smartPlaylists = ref<SmartPlaylist[]>([]);
  const historyMedia = ref<MediaFile[]>([]);
  const albumsSelectedForSlideshow = ref<{ [albumName: string]: boolean }>({});
  const globalMediaPoolForSelection = ref<MediaFile[]>([]);
  const totalMediaInPool = ref(0);
  const mediaUrlGenerator = ref<((path: string) => string) | null>(null);
  const thumbnailUrlGenerator = ref<((path: string) => string) | null>(null);

  const imageExtensionsSet = computed(
    () => new Set(supportedExtensions.value.images),
  );

  const allMediaFilesMap = computed(() => {
    const fileMap = new Map<string, MediaFile>();
    const traverse = (albums: Album[]) => {
      for (const album of albums) {
        if (album.textures) {
          for (const file of album.textures) {
            fileMap.set(file.path, file);
          }
        }
        if (album.children) traverse(album.children);
      }
    };
    traverse(allAlbums.value);
    return fileMap;
  });

  const videoExtensionsSet = computed(
    () => new Set(supportedExtensions.value.videos),
  );

  watch(
    albumsSelectedForSlideshow,
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
    const newSelection = { ...albumsSelectedForSlideshow.value };
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
    albumsSelectedForSlideshow.value = newSelection;
  };

  const fetchHistory = async (limit = 50) => {
    try {
      const items = await api.getRecentlyPlayed(limit);
      historyMedia.value = items.map((item) => {
        const name = item.file_path.split(/[\/\\]/).pop() || item.file_path;
        return {
          allMediaFilesMap,
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

      allAlbums.value = albums;
      mediaDirectories.value = directories;
      smartPlaylists.value = playlists;
      supportedExtensions.value = extensions;
      mediaUrlGenerator.value = mediaGen;
      thumbnailUrlGenerator.value = thumbGen;

      const savedSelection = localStorage.getItem('albumSelection');
      if (savedSelection) {
        try {
          albumsSelectedForSlideshow.value = JSON.parse(savedSelection);
        } catch (e) {
          console.error('Failed to parse saved album selection:', e);
          selectAllAlbumsRecursively(allAlbums.value);
        }
      } else {
        selectAllAlbumsRecursively(allAlbums.value);
      }
    } catch (error) {
      console.error('[useLibraryStore] Error during initial load:', error);
    }
  };

  const clearMediaPool = () => {
    globalMediaPoolForSelection.value = [];
  };

  const resetLibraryState = () => {
    globalMediaPoolForSelection.value = [];
    albumsSelectedForSlideshow.value = {};
    historyMedia.value = [];
  };

  return {
    allMediaFilesMap,
    isScanning,
    allAlbums,
    mediaDirectories,
    supportedExtensions,
    smartPlaylists,
    historyMedia,
    albumsSelectedForSlideshow,
    globalMediaPoolForSelection,
    totalMediaInPool,
    mediaUrlGenerator,
    thumbnailUrlGenerator,
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
