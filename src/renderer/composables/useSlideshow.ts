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

  const filterMedia = (mediaFiles: MediaFile[]): MediaFile[] => {
    if (!mediaFiles || mediaFiles.length === 0) return [];
    const filter = uiStore.mediaFilter;
    const isAll = filter === 'All';
    const isVideos = filter === 'Videos';
    const isImages = filter === 'Images';
    const videoSet = videoExtensionsSet.value;
    const imageSet = imageExtensionsSet.value;

    const len = mediaFiles.length;
    const result = new Array<MediaFile>(len);
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

  /**
   * Records a view in the background. Telemetry must never affect playback,
   * so failures (e.g. HTTP 429 from the web server's rate limiter) are only
   * logged.
   */
  const recordView = async (path: string) => {
    try {
      await api.recordMediaView(path);
    } catch (error) {
      console.error('Error recording media view:', error);
    }
  };

  /**
   * Bookkeeping for the item that has just become current. Every path that
   * puts an item on screen goes through here, so views and the countdown
   * behave the same however playback was started.
   * @returns Whether an item is now shown.
   */
  const displayMedia = (mediaItem: MediaFile | null): boolean => {
    if (!mediaItem) return false;

    // Re-arm the countdown for the new item (also after a video suspended
    // it). For videos, MediaDisplay.vue checks their duration on `play` and
    // suspends the timer if the video outlasts it, or loops a shorter one.
    // This happens before any I/O so that a slow or failed request cannot
    // stall the slideshow.
    if (playerStore.isTimerRunning || playerStore.isTimerPausedForVideo) {
      resumeSlideshowTimer();
    }

    // History sessions replay Recently Played; recording views there would
    // reorder the list being replayed.
    if (!uiStore.isHistoryMode) {
      mediaItem.viewCount = (mediaItem.viewCount ?? 0) + 1;
      void recordView(mediaItem.path);
    }
    return true;
  };

  /**
   * Picks a random item from `pool`, weighted towards less viewed items and
   * avoiding the recent history. The item on screen is never picked again
   * while the pool has anything else, also once the history covers every
   * other item and a new cycle starts.
   */
  const pickNextMediaItem = (pool: MediaFile[]): MediaFile | null => {
    const currentPath = playlistStore.currentItem?.path;
    const skipCurrent = currentPath !== undefined && pool.length > 1;

    const excludedPaths = new Set<string>();
    for (const item of playlistStore.history) {
      excludedPaths.add(item.path);
    }
    if (skipCurrent) excludedPaths.add(currentPath);

    let hasEligible = false;
    for (const item of pool) {
      if (!excludedPaths.has(item.path)) {
        hasEligible = true;
        break;
      }
    }
    if (!hasEligible && skipCurrent) {
      excludedPaths.clear();
      excludedPaths.add(currentPath);
    }

    return (
      selectWeightedRandom(pool, excludedPaths) ||
      pool[Math.floor(Math.random() * pool.length)] ||
      null
    );
  };

  /** @returns Whether a new item is now shown. */
  const pickAndDisplayNextMediaItem = async (): Promise<boolean> => {
    if (libraryStore.globalMediaPoolForSelection.length === 0) return false;

    const filteredPool = filteredGlobalMediaPool.value;
    libraryStore.totalMediaInPool = filteredPool.length;

    if (filteredPool.length === 0) return false;

    const selectedMedia = pickNextMediaItem(filteredPool);
    if (!selectedMedia) return false;

    playlistStore.playNext(selectedMedia);
    return displayMedia(playlistStore.currentItem);
  };

  let lastNavigationTime = 0;

  const navigateMedia = async (direction: number) => {
    if (!playerStore.isSlideshowActive) return;

    // Previous with no history (Z on the first item) has nothing to show:
    // keep the current item and its countdown as they are.
    if (direction < 0 && !playlistStore.hasPrevious) return;

    // Prevent double-navigation during crossfades/transitions
    const now = Date.now();
    if (now - lastNavigationTime < 400) return;
    lastNavigationTime = now;

    if (direction > 0) {
      if (playlistStore.hasNext) {
        playlistStore.playNext();
        displayMedia(playlistStore.currentItem);
      } else {
        await pickAndDisplayNextMediaItem();
      }
    } else {
      playlistStore.playPrevious();
      displayMedia(playlistStore.currentItem);
    }
  };

  const onTimerElapsed = async () => {
    try {
      await navigateMedia(1);
    } catch (error) {
      console.error('[Slideshow] Failed to advance to the next item:', error);
    } finally {
      // Showing the next item re-arms the countdown. If nothing was shown
      // (empty pool, slideshow ended), stop it instead of leaving it
      // "running" with nothing pending.
      if (playerStore.isTimerRunning && playerStore.slideshowTimerId === null) {
        playerStore.stopSlideshowTimer();
      }
    }
  };

  /** Starts (or restarts) the countdown for the current item. */
  const resumeSlideshowTimer = () => {
    // Without an active slideshow the countdown would elapse into nothing.
    if (!playerStore.isSlideshowActive) {
      playerStore.stopSlideshowTimer();
      return;
    }

    const duration =
      Math.max(1, Math.floor(playerStore.timerDuration) || 5) * 1000;
    playerStore.startSlideshowTimer(duration, () => {
      void onTimerElapsed();
    });
  };

  /** Stops the countdown until the user (or a new session) starts it again. */
  const pauseSlideshowTimer = () => {
    playerStore.stopSlideshowTimer();
  };

  /**
   * Suspends a running countdown while the current video plays; it resumes
   * with the next item or through {@link resumeSlideshowTimerAfterVideo}.
   */
  const pauseSlideshowTimerForVideo = () => {
    playerStore.suspendSlideshowTimerForVideo();
  };

  /**
   * Resumes the countdown only if a video suspended it, never after a user
   * pause or a stop.
   */
  const resumeSlideshowTimerAfterVideo = () => {
    if (playerStore.isTimerPausedForVideo) resumeSlideshowTimer();
  };

  const toggleSlideshowTimer = () => {
    if (playerStore.isTimerRunning) {
      pauseSlideshowTimer();
    } else {
      resumeSlideshowTimer();
    }
  };

  /** Ends the slideshow: no countdown, and navigation is disabled. */
  const stopSlideshow = () => {
    playerStore.stopSlideshow();
  };

  const toggleAlbumSelection = (albumId: string, isSelected?: boolean) => {
    if (typeof isSelected === 'boolean') {
      libraryStore.albumsSelectedForSlideshow[albumId] = isSelected;
    } else {
      libraryStore.albumsSelectedForSlideshow[albumId] =
        !libraryStore.albumsSelectedForSlideshow[albumId];
    }
  };

  /**
   * Makes `pool` the random-selection pool of a new, active session shown in
   * the player. The countdown keeps its running state; showing the first
   * item re-arms it.
   */
  const beginSession = (pool: MediaFile[], historyMode: boolean) => {
    libraryStore.globalMediaPoolForSelection = pool;
    uiStore.isHistoryMode = historyMode;
    uiStore.viewMode = 'player';
    playerStore.isSlideshowActive = true;
  };

  /**
   * Shuffles all albums selected for the slideshow.
   * @returns Whether the slideshow started. When the selection has nothing
   *   that passes the media filter, the current session is left untouched.
   */
  const startSlideshow = async (): Promise<boolean> => {
    if (!libraryStore.allAlbums) return false;

    const pool = collectSelectedTextures(
      libraryStore.allAlbums,
      libraryStore.albumsSelectedForSlideshow,
    );
    if (filterMedia(pool).length === 0) return false;

    beginSession(pool, false);
    playlistStore.clearPlaylist();
    return pickAndDisplayNextMediaItem();
  };

  /**
   * Plays one album (or smart playlist), unwatched items first.
   * @returns Whether the slideshow started. When the album has nothing that
   *   passes the media filter, the current session is left untouched.
   */
  const startIndividualAlbumSlideshow = async (
    album: Album,
  ): Promise<boolean> => {
    if (!album || !Array.isArray(album.textures) || album.textures.length === 0)
      return false;

    const filtered = filterMedia(album.textures);
    if (filtered.length === 0) return false;

    const unwatched = filtered.filter((f) => !f.viewCount);
    const order = shuffleArray(unwatched.length > 0 ? unwatched : filtered);

    beginSession([...album.textures], false);
    playlistStore.setQueue(order.slice(1));
    playlistStore.playNext(order[0]);
    return displayMedia(playlistStore.currentItem);
  };

  /** Replays Recently Played in order, with the countdown stopped. */
  const startHistorySlideshow = (historyMedia: MediaFile[]) => {
    if (!historyMedia || historyMedia.length === 0) return;

    const mediaArray = toRaw(historyMedia).slice();
    pauseSlideshowTimer();
    beginSession(mediaArray, true);
    playlistStore.setQueue(mediaArray);
    playlistStore.playNext(); // Sets the first item as current
    displayMedia(playlistStore.currentItem);
  };

  /**
   * Plays `list[index]` with the rest of the list queued after it, as when an
   * item is clicked in the grid. The list becomes the random-selection pool,
   * so playback stays within it once the queue runs out. The countdown is
   * stopped until the user starts it; the session keeps the current history
   * mode (set when the grid was opened).
   * @returns Whether the item is now shown.
   */
  const playFromList = async (
    list: MediaFile[],
    index: number,
  ): Promise<boolean> => {
    const items = toRaw(list).slice();
    const item = items[index];
    if (!item) return false;

    pauseSlideshowTimer();
    beginSession(items, uiStore.isHistoryMode);
    playlistStore.setQueue(items.slice(index + 1));
    playlistStore.playNext(item);
    return displayMedia(playlistStore.currentItem);
  };

  /**
   * Plays a queued item right away and removes it from the queue. The session
   * (pool, history mode, countdown) carries on as after a navigation.
   * @returns Whether the item is now shown.
   */
  const playQueuedItem = async (item: MediaFile): Promise<boolean> => {
    const index = playlistStore.queue.indexOf(item);
    if (index === -1) return false;

    playlistStore.queue.splice(index, 1);
    playlistStore.playNext(item);
    uiStore.viewMode = 'player';
    playerStore.isSlideshowActive = true;
    return displayMedia(playlistStore.currentItem);
  };

  const openAlbumInGrid = (album: Album) => {
    // Leaving the player ends the slideshow, so the hidden player cannot keep
    // advancing and recording views.
    stopSlideshow();
    uiStore.isHistoryMode = false;
    uiStore.gridMediaFiles = filterMedia(collectTexturesRecursive(album));
    uiStore.viewMode = 'grid';
  };

  /**
   * Re-picks after the media filter changed. The session's pool is kept (the
   * filter applies to it reactively); only the queue, built under the old
   * filter, is dropped.
   */
  const reapplyFilter = async () => {
    if (!playerStore.isSlideshowActive) return;
    playlistStore.clearQueue();
    await pickAndDisplayNextMediaItem();
  };

  return {
    navigateMedia,
    toggleSlideshowTimer,
    pauseSlideshowTimer,
    resumeSlideshowTimer,
    pauseSlideshowTimerForVideo,
    resumeSlideshowTimerAfterVideo,
    stopSlideshow,
    toggleAlbumSelection,
    startSlideshow,
    startIndividualAlbumSlideshow,
    startHistorySlideshow,
    playFromList,
    playQueuedItem,
    openAlbumInGrid,
    pickAndDisplayNextMediaItem,
    reapplyFilter,
    filterMedia,
    selectWeightedRandom,
    shuffleArray,
  };
}
