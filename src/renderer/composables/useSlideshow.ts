/**
 * @file Provides composable functions for managing slideshow logic.
 * This includes starting/stopping slideshows, navigating media, filtering,
 * and selecting media items based on a weighted random algorithm.
 */
import { computed, toRaw } from 'vue';
import { useLibraryStore } from './useLibraryStore';
import { usePlayerStore } from './usePlayerStore';
import { useUIStore } from './useUIStore';
import {
  collectTexturesRecursive,
  collectSelectedTextures,
} from '../utils/albumUtils';
import { selectWeightedRandom, shuffleArray } from '../utils/selectionUtils';
import { getCachedExtension } from '../utils/mediaUtils';
import type { Album, MediaFile } from '../../core/types';
import { api } from '../api';

/**
 * A Vue composable that provides functions for controlling the media slideshow.
 */
export function useSlideshow() {
  const libraryStore = useLibraryStore();
  const playerStore = usePlayerStore();
  const uiStore = useUIStore();

  const { imageExtensionsSet, videoExtensionsSet } = libraryStore;
  const { stopSlideshow } = playerStore;

  /**
   * Filters a list of media files based on the current filter setting in the global state.
   * @param mediaFiles - The array of media files to filter.
   * @returns The filtered array of media files.
   */
  const filterMedia = (mediaFiles: MediaFile[]): MediaFile[] => {
    if (!mediaFiles || mediaFiles.length === 0) return [];

    const filter = uiStore.state.mediaFilter;

    return mediaFiles.filter((file) => {
      // Guard against missing path property
      if (!file || !file.path || typeof file.path !== 'string') {
        console.warn('Skipping media item with invalid or missing path:', file);
        return false;
      }

      if (filter === 'All') return true;

      const ext = getCachedExtension(file);
      if (!ext) return false;

      if (filter === 'Videos') {
        return videoExtensionsSet.value.has(ext);
      } else if (filter === 'Images') {
        return imageExtensionsSet.value.has(ext);
      }
      return true; // Should not be reached with controlled filters
    });
  };

  /**
   * Memoized filtered pool to avoid O(N) filtering on every slide change.
   * This significantly reduces CPU usage when the media pool is large (e.g., 10k+ items).
   */
  const filteredGlobalMediaPool = computed(() => {
    return filterMedia(libraryStore.state.globalMediaPoolForSelection);
  });

  /**
   * Records a view for the given media item.
   * @param mediaItem - The media item to display.
   */
  const displayMedia = async (mediaItem: MediaFile | null) => {
    if (!mediaItem) return;
    try {
      // Optimistically update the local view count so the UI reflects it immediately
      if (!uiStore.state.isHistoryMode) {
        if (mediaItem.viewCount === undefined) {
          mediaItem.viewCount = 0;
        }
        mediaItem.viewCount++;

        await api.recordMediaView(mediaItem.path);
      }
      if (playerStore.state.isTimerRunning) {
        resumeSlideshowTimer();
      }
    } catch (error) {
      console.error('Error recording media view:', error);
      // Rollback if needed, but low risk
    }
  };

  /**
   * Selects the next media item using a weighted random algorithm and displays it.
   */
  const pickAndDisplayNextMediaItem = async () => {
    let selectedMedia: MediaFile | null = null;

    // Standard Logic (fallback or default)
    if (!selectedMedia) {
      if (libraryStore.state.globalMediaPoolForSelection.length === 0) {
        console.warn('No media files available in the pool.');
        return;
      }
      // Use memoized filtered pool
      const filteredPool = filteredGlobalMediaPool.value;
      libraryStore.state.totalMediaInPool = filteredPool.length;

      if (filteredPool.length === 0) {
        console.warn('Media pool is empty or no media matches the filter.');
        return;
      }

      const historySize = Math.min(
        5,
        playerStore.state.displayedMediaFiles.length,
      );
      // Optimization: Use a Set for O(1) lookups in selectWeightedRandom
      // Avoids .map() allocation on every tick
      const historyPaths = new Set<string>();
      const startIdx = Math.max(
        0,
        playerStore.state.displayedMediaFiles.length - historySize,
      );
      for (
        let i = startIdx;
        i < playerStore.state.displayedMediaFiles.length;
        i++
      ) {
        historyPaths.add(playerStore.state.displayedMediaFiles[i].path);
      }

      selectedMedia =
        selectWeightedRandom(filteredPool, historyPaths) ||
        filteredPool[Math.floor(Math.random() * filteredPool.length)];
    }

    if (selectedMedia) {
      playerStore.state.displayedMediaFiles.push(selectedMedia);
      playerStore.state.currentMediaIndex =
        playerStore.state.displayedMediaFiles.length - 1;
      playerStore.state.currentMediaItem = selectedMedia;
      if (playerStore.state.displayedMediaFiles.length > 100) {
        playerStore.state.displayedMediaFiles.shift();
        playerStore.state.currentMediaIndex--;
      }
      await displayMedia(playerStore.state.currentMediaItem);
    }
  };

  /**
   * Navigates to the next or previous media item in the slideshow history.
   * If at the end of history, a new random item is picked.
   * @param direction - The direction to navigate (-1 for previous, 1 for next).
   */
  const navigateMedia = async (direction: number) => {
    if (!playerStore.state.isSlideshowActive) return;

    if (direction > 0) {
      // Next
      if (
        playerStore.state.currentMediaIndex <
        playerStore.state.displayedMediaFiles.length - 1
      ) {
        playerStore.state.currentMediaIndex++;
        playerStore.state.currentMediaItem =
          playerStore.state.displayedMediaFiles[
            playerStore.state.currentMediaIndex
          ];
        await displayMedia(playerStore.state.currentMediaItem);
      } else {
        await pickAndDisplayNextMediaItem();
      }
    } else {
      // Previous
      if (playerStore.state.currentMediaIndex > 0) {
        playerStore.state.currentMediaIndex--;
        playerStore.state.currentMediaItem =
          playerStore.state.displayedMediaFiles[
            playerStore.state.currentMediaIndex
          ];
        await displayMedia(playerStore.state.currentMediaItem);
      }
    }
  };

  /**
   * Resumes the slideshow timer.
   */
  const resumeSlideshowTimer = () => {
    if (playerStore.state.slideshowTimerId) {
      clearInterval(playerStore.state.slideshowTimerId);
    }
    playerStore.state.isTimerRunning = true;
    playerStore.state.timerProgress = 100;

    const duration = playerStore.state.timerDuration * 1000;
    const interval = 50; // Update every 50ms
    let elapsed = 0;

    playerStore.state.slideshowTimerId = setInterval(() => {
      elapsed += interval;
      const progress = Math.max(0, 100 - (elapsed / duration) * 100);
      playerStore.state.timerProgress = progress;

      if (progress <= 0) {
        if (playerStore.state.slideshowTimerId)
          clearInterval(playerStore.state.slideshowTimerId);
        navigateMedia(1);
      }
    }, interval);
  };

  /**
   * Pauses the slideshow timer.
   */
  const pauseSlideshowTimer = () => {
    if (playerStore.state.slideshowTimerId) {
      clearInterval(playerStore.state.slideshowTimerId);
      playerStore.state.slideshowTimerId = null;
    }
    playerStore.state.isTimerRunning = false;
  };

  /**
   * Toggles the slideshow timer on or off.
   */
  const toggleSlideshowTimer = () => {
    if (playerStore.state.isTimerRunning) {
      pauseSlideshowTimer();
    } else {
      resumeSlideshowTimer();
    }
  };

  /**
   * Toggles the selection state of an album for the global slideshow.
   * @param albumId - The ID of the album to toggle.
   * @param isSelected - Explicitly set the selection state.
   */
  const toggleAlbumSelection = (albumId: string, isSelected?: boolean) => {
    if (typeof isSelected === 'boolean') {
      libraryStore.state.albumsSelectedForSlideshow[albumId] = isSelected;
    } else {
      libraryStore.state.albumsSelectedForSlideshow[albumId] =
        !libraryStore.state.albumsSelectedForSlideshow[albumId];
    }
  };

  /**
   * Updates the selection state for a batch of albums.
   * Optimized to switch between in-place mutation and object replacement
   * based on the size of the batch to minimize reactivity overhead.
   * @param ids - The list of album IDs to update.
   * @param isSelected - The new selection state.
   */
  const setBatchAlbumSelection = (
    ids: string[] | readonly string[],
    isSelected: boolean,
  ) => {
    // Bolt Optimization: Hybrid update strategy
    // Threshold determined by benchmarking: ~50 items
    // Small batches: In-place mutation is faster (avoids full re-render of large tree caused by prop change)
    // Large batches: Object replacement is faster (avoids N reactivity triggers and N watcher callbacks)
    if (ids.length > 50) {
      const newSelection = { ...libraryStore.state.albumsSelectedForSlideshow };
      for (const id of ids) {
        newSelection[id] = isSelected;
      }
      libraryStore.state.albumsSelectedForSlideshow = newSelection;
    } else {
      for (const id of ids) {
        libraryStore.state.albumsSelectedForSlideshow[id] = isSelected;
      }
    }
  };

  /**
   * Starts a global slideshow using all selected albums.
   */
  const startSlideshow = async () => {
    if (!libraryStore.state.allAlbums) {
      return;
    }
    libraryStore.state.globalMediaPoolForSelection = collectSelectedTextures(
      libraryStore.state.allAlbums,
      libraryStore.state.albumsSelectedForSlideshow,
    );

    if (libraryStore.state.globalMediaPoolForSelection.length === 0) {
      console.warn('No albums selected for slideshow.');
      return;
    }
    playerStore.state.isSlideshowActive = true;
    playerStore.state.displayedMediaFiles = [];
    playerStore.state.currentMediaIndex = -1;
    await pickAndDisplayNextMediaItem();
  };

  /**
   * Starts a slideshow for an individual album.
   * @param album - The album to start the slideshow for.
   */
  const startIndividualAlbumSlideshow = async (album: Album) => {
    if (!album || !Array.isArray(album.textures)) {
      console.warn('Album has no valid textures array.');
      return;
    }
    if (album.textures.length === 0) {
      console.warn('No media files in this album.');
      return;
    }
    libraryStore.state.globalMediaPoolForSelection = [...album.textures];
    playerStore.state.isSlideshowActive = true;
    playerStore.state.displayedMediaFiles = [];
    playerStore.state.currentMediaIndex = -1;
    await pickAndDisplayNextMediaItem();
  };

  /**
   * Starts a slideshow specifically from the history list preserving order.
   * @param historyMedia - The array of media files from the user's history
   */
  const startHistorySlideshow = (historyMedia: MediaFile[]) => {
    if (!historyMedia || historyMedia.length === 0) return;

    const mediaArray = toRaw(historyMedia).slice();
    libraryStore.state.globalMediaPoolForSelection = mediaArray;
    playerStore.state.displayedMediaFiles = mediaArray;
    playerStore.state.currentMediaIndex = 0;
    playerStore.state.currentMediaItem = mediaArray[0];
    uiStore.state.viewMode = 'player';
    uiStore.state.isHistoryMode = true;
    playerStore.state.isSlideshowActive = true;
    playerStore.state.isTimerRunning = false;
  };

  /**
   * Opens an album and its children in Grid View.
   * @param album - The album to open.
   */
  const openAlbumInGrid = (album: Album) => {
    const allMedia = collectTexturesRecursive(album);
    uiStore.state.gridMediaFiles = filterMedia(allMedia);
    uiStore.state.viewMode = 'grid';
    playerStore.state.isSlideshowActive = false;
    stopSlideshow();
  };

  /**
   * Re-applies the current media filter and picks a new item.
   */
  const reapplyFilter = async () => {
    if (playerStore.state.isSlideshowActive) {
      libraryStore.state.globalMediaPoolForSelection = collectSelectedTextures(
        libraryStore.state.allAlbums,
        libraryStore.state.albumsSelectedForSlideshow,
      );
      playerStore.state.displayedMediaFiles = [];
      playerStore.state.currentMediaIndex = -1;
      await pickAndDisplayNextMediaItem();
    }
  };

  return {
    navigateMedia,
    toggleSlideshowTimer,
    pauseSlideshowTimer,
    resumeSlideshowTimer,
    toggleAlbumSelection,
    setBatchAlbumSelection,
    startSlideshow,
    startIndividualAlbumSlideshow,
    startHistorySlideshow,
    openAlbumInGrid,
    pickAndDisplayNextMediaItem,
    reapplyFilter,
    filterMedia,
    // Exported for testing/mocking if needed, but primarily used internally via imports
    selectWeightedRandom,
    shuffleArray,
  };
}
