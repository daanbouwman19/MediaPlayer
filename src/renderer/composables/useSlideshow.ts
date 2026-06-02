/**
 * @file Provides composable functions for managing slideshow logic.
 */
import { computed, toRaw } from 'vue';
import { storeToRefs } from 'pinia';
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
import type { Album, MediaFile } from '../../core/media/types';
import { api } from '../api/index';

export function useSlideshow() {
  const libraryStore = useLibraryStore();
  const playerStore = usePlayerStore();
  const playlistStore = usePlaylistStore();
  const uiStore = useUIStore();

  const { imageExtensionsSet, videoExtensionsSet } = storeToRefs(libraryStore);

  const clearSlideshowTimer = () => {
    if (playerStore.slideshowTimerId) {
      clearTimeout(playerStore.slideshowTimerId);
      playerStore.slideshowTimerId = null;
    }
    playerStore.timerStartTime = null;
    playerStore.timerEndTime = null;
  };

  const filterMedia = (mediaFiles: MediaFile[]): MediaFile[] => {
    if (!mediaFiles || mediaFiles.length === 0) return [];
    const filter = uiStore.mediaFilter;
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
    return filterMedia(libraryStore.globalMediaPoolForSelection);
  });

  const displayMedia = async (mediaItem: MediaFile | null) => {
    if (!mediaItem) return;
    try {
      if (!uiStore.isHistoryMode) {
        if (mediaItem.viewCount === undefined) {
          mediaItem.viewCount = 0;
        }
        mediaItem.viewCount++;
        await api.recordMediaView(mediaItem.path);
      }

      if (playerStore.isTimerRunning) {
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
    if (libraryStore.globalMediaPoolForSelection.length === 0) return;

    const filteredPool = filteredGlobalMediaPool.value;
    libraryStore.totalMediaInPool = filteredPool.length;

    if (filteredPool.length === 0) return;

    const historyPaths = new Set<string>();
    for (const item of playlistStore.history) {
      historyPaths.add(item.path);
    }

    const selectedMedia =
      selectWeightedRandom(filteredPool, historyPaths) ||
      filteredPool[Math.floor(Math.random() * filteredPool.length)];

    if (selectedMedia) {
      playlistStore.playNext(selectedMedia);
      await displayMedia(playlistStore.currentItem);
    }
  };

  let lastNavigationTime = 0;

  const navigateMedia = async (direction: number) => {
    if (!playerStore.isSlideshowActive) return;

    // Prevent double-navigation during crossfades/transitions
    const now = Date.now();
    if (now - lastNavigationTime < 400) return;
    lastNavigationTime = now;

    clearSlideshowTimer();

    if (direction > 0) {
      if (playlistStore.hasNext) {
        playlistStore.playNext();
        await displayMedia(playlistStore.currentItem);
      } else {
        await pickAndDisplayNextMediaItem();
      }
    } else {
      if (playlistStore.hasPrevious) {
        playlistStore.playPrevious();
        await displayMedia(playlistStore.currentItem);
      }
    }
  };

  const resumeSlideshowTimer = () => {
    clearSlideshowTimer();
    playerStore.isTimerRunning = true;
    playerStore.timerProgress = 100;

    const duration =
      Math.max(1, Math.floor(playerStore.timerDuration) || 5) * 1000;
    const now = Date.now();
    playerStore.timerStartTime = now;
    playerStore.timerEndTime = now + duration;

    playerStore.slideshowTimerId = setTimeout(() => {
      clearSlideshowTimer();
      navigateMedia(1);
    }, duration);
  };

  const pauseSlideshowTimer = () => {
    clearSlideshowTimer();
    playerStore.isTimerRunning = false;
  };

  const toggleSlideshowTimer = () => {
    if (playerStore.isTimerRunning) {
      pauseSlideshowTimer();
    } else {
      resumeSlideshowTimer();
    }
  };

  const toggleAlbumSelection = (albumId: string, isSelected?: boolean) => {
    if (typeof isSelected === 'boolean') {
      libraryStore.albumsSelectedForSlideshow[albumId] = isSelected;
    } else {
      libraryStore.albumsSelectedForSlideshow[albumId] =
        !libraryStore.albumsSelectedForSlideshow[albumId];
    }
  };

  const startSlideshow = async () => {
    if (!libraryStore.allAlbums) return;

    libraryStore.globalMediaPoolForSelection = collectSelectedTextures(
      libraryStore.allAlbums,
      libraryStore.albumsSelectedForSlideshow,
    );

    if (libraryStore.globalMediaPoolForSelection.length === 0) return;

    playerStore.isSlideshowActive = true;
    playlistStore.clearPlaylist();
    await pickAndDisplayNextMediaItem();
  };

  const startIndividualAlbumSlideshow = async (album: Album) => {
    if (!album || !Array.isArray(album.textures) || album.textures.length === 0)
      return;

    libraryStore.globalMediaPoolForSelection = [...album.textures];
    playerStore.isSlideshowActive = true;

    const filtered = filterMedia(album.textures);
    const unwatched = filtered.filter((f) => !f.viewCount);
    const pool = shuffleArray(unwatched.length > 0 ? unwatched : filtered);

    playlistStore.clearPlaylist();
    playlistStore.setQueue(pool.slice(1));
    playlistStore.playNext(pool[0]);
    await displayMedia(playlistStore.currentItem);
  };

  const startHistorySlideshow = (historyMedia: MediaFile[]) => {
    if (!historyMedia || historyMedia.length === 0) return;

    const mediaArray = toRaw(historyMedia).slice();
    libraryStore.globalMediaPoolForSelection = mediaArray;

    playlistStore.setQueue(mediaArray);
    playlistStore.playNext(); // Sets the first item as current

    uiStore.viewMode = 'player';
    uiStore.isHistoryMode = true;
    playerStore.isSlideshowActive = true;
    playerStore.isTimerRunning = false;
  };

  const openAlbumInGrid = (album: Album) => {
    const allMedia = collectTexturesRecursive(album);
    uiStore.gridMediaFiles = filterMedia(allMedia);
    uiStore.viewMode = 'grid';
    playerStore.isSlideshowActive = false;
    playerStore.stopSlideshow();
  };

  const reapplyFilter = async () => {
    if (playerStore.isSlideshowActive) {
      libraryStore.globalMediaPoolForSelection = collectSelectedTextures(
        libraryStore.allAlbums,
        libraryStore.albumsSelectedForSlideshow,
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
