/**
 * @file Provides composable functions for managing slideshow logic.
 */
import { computed, toRaw } from 'vue';
import { useLibraryStore } from './useLibraryStore';
import { usePlayerStore } from './usePlayerStore';
import { usePlaylistStore } from './usePlaylistStore';
import { useUIStore } from './useUIStore';
import {
  collectTexturesRecursive,
  collectSelectedTextures,
} from '../utils/albumUtils';
import { selectWeightedRandom, shuffleArray } from '../utils/selectionUtils';
import { getCachedExtension } from '../utils/mediaUtils';
import type { Album, MediaFile } from '../../core/types';
import { api } from '../api';

export function useSlideshow() {
  const libraryStore = useLibraryStore();
  const playerStore = usePlayerStore();
  const playlistStore = usePlaylistStore();
  const uiStore = useUIStore();

  const { imageExtensionsSet, videoExtensionsSet } = libraryStore;
  const { stopSlideshow } = playerStore;

  const clearSlideshowTimer = () => {
    if (playerStore.state.slideshowTimerId) {
      clearInterval(playerStore.state.slideshowTimerId);
      playerStore.state.slideshowTimerId = null;
    }
  };

  const filterMedia = (mediaFiles: MediaFile[]): MediaFile[] => {
    if (!mediaFiles || mediaFiles.length === 0) return [];
    const filter = uiStore.state.mediaFilter;
    const isAll = filter === 'All';
    const isVideos = filter === 'Videos';
    const isImages = filter === 'Images';
    const videoSet = videoExtensionsSet.value;
    const imageSet = imageExtensionsSet.value;

    const len = mediaFiles.length;
    const result: MediaFile[] = new Array(len);
    let count = 0;

    for (let i = 0; i < len; i++) {
      const file = mediaFiles[i];
      if (!file || !file.path || typeof file.path !== 'string') continue;

      if (isAll) {
        result[count++] = file;
        continue;
      }

      const ext = getCachedExtension(file);
      if (!ext) continue;

      if (isVideos) {
        if (videoSet.has(ext)) result[count++] = file;
      } else if (isImages) {
        if (imageSet.has(ext)) result[count++] = file;
      } else {
        result[count++] = file;
      }
    }
    result.length = count;
    return result;
  };

  const filteredGlobalMediaPool = computed(() => {
    return filterMedia(libraryStore.state.globalMediaPoolForSelection);
  });

  const displayMedia = async (mediaItem: MediaFile | null) => {
    if (!mediaItem) return;
    try {
      if (!uiStore.state.isHistoryMode) {
        if (mediaItem.viewCount === undefined) {
          mediaItem.viewCount = 0;
        }
        mediaItem.viewCount++;
        await api.recordMediaView(mediaItem.path);
      }

      if (playerStore.state.isTimerRunning) {
        // We now start the slideshow timer for ALL media.
        // For videos, MediaDisplay.vue will check their duration on `play`
        // and pause the timer if the video is longer than the timer duration,
        // or loop the video if it's shorter.
        resumeSlideshowTimer();
      }
    } catch (error) {
      console.error('Error recording media view:', error);
    }
  };

  const pickAndDisplayNextMediaItem = async () => {
    if (libraryStore.state.globalMediaPoolForSelection.length === 0) return;

    const filteredPool = filteredGlobalMediaPool.value;
    libraryStore.state.totalMediaInPool = filteredPool.length;

    if (filteredPool.length === 0) return;

    const historyPaths = new Set<string>();
    for (const item of playlistStore.state.history) {
      historyPaths.add(item.path);
    }

    const selectedMedia =
      selectWeightedRandom(filteredPool, historyPaths) ||
      filteredPool[Math.floor(Math.random() * filteredPool.length)];

    if (selectedMedia) {
      playlistStore.playNext(selectedMedia);
      await displayMedia(playlistStore.state.currentItem);
    }
  };

  let lastNavigationTime = 0;

  const navigateMedia = async (direction: number) => {
    if (!playerStore.state.isSlideshowActive) return;

    // Prevent double-navigation during crossfades/transitions
    const now = Date.now();
    if (now - lastNavigationTime < 400) return;
    lastNavigationTime = now;

    clearSlideshowTimer();

    if (direction > 0) {
      if (playlistStore.hasNext.value) {
        playlistStore.playNext();
        await displayMedia(playlistStore.state.currentItem);
      } else {
        await pickAndDisplayNextMediaItem();
      }
    } else {
      if (playlistStore.hasPrevious.value) {
        playlistStore.playPrevious();
        await displayMedia(playlistStore.state.currentItem);
      }
    }
  };

  const resumeSlideshowTimer = () => {
    clearSlideshowTimer();
    playerStore.state.isTimerRunning = true;
    playerStore.state.timerProgress = 100;

    const duration = playerStore.state.timerDuration * 1000;
    const interval = 50;
    let elapsed = 0;

    playerStore.state.slideshowTimerId = setInterval(() => {
      elapsed += interval;
      const progress = Math.max(0, 100 - (elapsed / duration) * 100);
      playerStore.state.timerProgress = progress;

      if (progress <= 0) {
        clearSlideshowTimer();
        navigateMedia(1);
      }
    }, interval);
  };

  const pauseSlideshowTimer = () => {
    clearSlideshowTimer();
    playerStore.state.isTimerRunning = false;
  };

  const toggleSlideshowTimer = () => {
    if (playerStore.state.isTimerRunning) {
      pauseSlideshowTimer();
    } else {
      resumeSlideshowTimer();
    }
  };

  const toggleAlbumSelection = (albumId: string, isSelected?: boolean) => {
    if (typeof isSelected === 'boolean') {
      libraryStore.state.albumsSelectedForSlideshow[albumId] = isSelected;
    } else {
      libraryStore.state.albumsSelectedForSlideshow[albumId] =
        !libraryStore.state.albumsSelectedForSlideshow[albumId];
    }
  };

  const startSlideshow = async () => {
    if (!libraryStore.state.allAlbums) return;

    libraryStore.state.globalMediaPoolForSelection = collectSelectedTextures(
      libraryStore.state.allAlbums,
      libraryStore.state.albumsSelectedForSlideshow,
    );

    if (libraryStore.state.globalMediaPoolForSelection.length === 0) return;

    playerStore.state.isSlideshowActive = true;
    playlistStore.clearPlaylist();
    await pickAndDisplayNextMediaItem();
  };

  const startIndividualAlbumSlideshow = async (album: Album) => {
    if (!album || !Array.isArray(album.textures) || album.textures.length === 0)
      return;

    libraryStore.state.globalMediaPoolForSelection = [...album.textures];
    playerStore.state.isSlideshowActive = true;

    const filtered = filterMedia(album.textures);
    const unwatched = filtered.filter((f) => !f.viewCount);
    const pool = shuffleArray(unwatched.length > 0 ? unwatched : filtered);

    playlistStore.clearPlaylist();
    playlistStore.setQueue(pool.slice(1));
    playlistStore.playNext(pool[0]);
    await displayMedia(playlistStore.state.currentItem);
  };

  const startHistorySlideshow = (historyMedia: MediaFile[]) => {
    if (!historyMedia || historyMedia.length === 0) return;

    const mediaArray = toRaw(historyMedia).slice();
    libraryStore.state.globalMediaPoolForSelection = mediaArray;

    playlistStore.setQueue(mediaArray);
    playlistStore.playNext(); // Sets the first item as current

    uiStore.state.viewMode = 'player';
    uiStore.state.isHistoryMode = true;
    playerStore.state.isSlideshowActive = true;
    playerStore.state.isTimerRunning = false;
  };

  const openAlbumInGrid = (album: Album) => {
    const allMedia = collectTexturesRecursive(album);
    uiStore.state.gridMediaFiles = filterMedia(allMedia);
    uiStore.state.viewMode = 'grid';
    playerStore.state.isSlideshowActive = false;
    stopSlideshow();
  };

  const reapplyFilter = async () => {
    if (playerStore.state.isSlideshowActive) {
      libraryStore.state.globalMediaPoolForSelection = collectSelectedTextures(
        libraryStore.state.allAlbums,
        libraryStore.state.albumsSelectedForSlideshow,
      );
      playlistStore.clearPlaylist();
      await pickAndDisplayNextMediaItem();
    }
  };

  return {
    navigateMedia,
    toggleSlideshowTimer,
    pauseSlideshowTimer,
    resumeSlideshowTimer,
    toggleAlbumSelection,
    startSlideshow,
    startIndividualAlbumSlideshow,
    startHistorySlideshow,
    openAlbumInGrid,
    pickAndDisplayNextMediaItem,
    reapplyFilter,
    filterMedia,
    selectWeightedRandom,
    shuffleArray,
  };
}
