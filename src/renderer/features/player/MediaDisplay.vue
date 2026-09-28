<template>
  <div class="w-full h-full flex flex-col justify-center items-center relative">
    <div
      class="media-display-area mb-3 grow w-full flex items-center justify-center relative"
    >
      <!-- State Handling: Mutually Exclusive Blocks -->

      <!-- 1. Loading / Transcoding / Buffering Overlay -->
      <TranscodingStatus
        :is-loading="isLoading && !mediaUrl"
        :is-transcoding-loading="isTranscodingLoading"
        :is-buffering="isBuffering"
        :progress="transcodingProgress"
      />

      <!-- 2. Placeholder (No Item & Not Loading) -->
      <div
        v-if="!currentMediaItem && !isLoading"
        class="flex flex-col items-center justify-center p-6 text-center z-10"
      >
        <template v-if="mediaDirectories.length === 0">
          <div class="mb-4 p-4 rounded-full bg-accent/10 text-accent">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-12 h-12"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.5"
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <h2 class="text-2xl font-bold text-color mb-2">
            Welcome to Media Player
          </h2>
          <p class="text-muted mb-6 max-w-md">
            Your library is currently empty. Add a folder to start enjoying your
            media collection.
          </p>
          <button
            class="glass-button px-6 py-3 flex items-center gap-2 font-semibold text-button-text bg-accent hover:bg-accent-hover border-accent/50"
            @click="openSourcesModal"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-5 h-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fill-rule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clip-rule="evenodd"
              />
            </svg>
            Add Media Source
          </button>
        </template>
        <template v-else>
          <div
            class="flex flex-col items-center gap-3 text-muted opacity-80"
            role="status"
            aria-live="polite"
          >
            <PlaylistIcon class="w-16 h-16 opacity-50" aria-hidden="true" />
            <p class="text-lg font-medium">Select an album to start playback</p>
            <button
              v-if="!isSidebarVisible"
              class="glass-button px-4 py-2 mt-2 flex items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
              @click="isSidebarVisible = true"
            >
              <MenuIcon class="w-4 h-4" aria-hidden="true" />
              Open Library
            </button>
            <p v-else class="text-sm">Choose from the sidebar to begin</p>
            <p class="text-xs mt-4 text-muted">
              Press
              <kbd
                class="px-1 py-0.5 rounded bg-black/10 border border-black/10 font-mono text-muted"
                >?</kbd
              >
              for shortcuts
            </p>
          </div>
        </template>
      </div>

      <!-- 3. Error Message (Only if not loading) -->
      <p
        v-else-if="error"
        class="text-red-400 placeholder z-10 text-center px-4"
      >
        {{ error }}
      </p>

      <!-- 4. Unsupported Format Message (direct play and transcoding both failed) -->
      <div
        v-else-if="!isVideoSupported && !isImage"
        class="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-6 text-center"
      >
        <p class="text-lg md:text-xl font-bold text-red-400 mb-2">
          Video Format Not Supported
        </p>
        <p class="text-muted mb-4 text-sm md:text-base">
          This video codec (likely HEVC) cannot be played natively.
        </p>
        <button
          class="glass-button px-6 py-3 flex items-center gap-2"
          :class="{ 'opacity-70 cursor-wait': isOpeningVlc }"
          :disabled="isOpeningVlc"
          @click="openInVlc"
        >
          <SpinnerIcon v-if="isOpeningVlc" class="animate-spin w-5 h-5" />
          <VlcIcon v-else />
          {{ isOpeningVlc ? 'Opening...' : 'Open in VLC' }}
        </button>
        <button
          class="glass-button px-6 py-3 flex items-center gap-2 mt-2"
          @click="() => tryTranscoding()"
        >
          Try Transcoding
        </button>
      </div>

      <!-- 5. Media Content -->
      <template v-else>
        <!-- The Transition stays mounted and each child requires a URL: on an
             item change the previous media fades out right away and the new
             item's player only mounts once its own URL is known. -->
        <Transition name="media-fade" mode="out-in">
          <img
            v-if="mediaUrl && isImage"
            :key="(currentMediaItem?.path || '') + '-img'"
            :src="mediaUrl"
            :alt="currentMediaItem?.name"
            @error="handleMediaError"
          />
          <VRVideoPlayer
            v-else-if="mediaUrl && isVrMode"
            ref="vrPlayerRef"
            :key="(currentMediaItem?.path || '') + '-vr'"
            :src="mediaUrl"
            :poster="posterUrl"
            :is-playing="isPlaying"
            :initial-time="savedCurrentTime"
            :is-controls-visible="isControlsVisible"
            @timeupdate="handleTimeUpdate"
            @update:video-element="handleVideoElementUpdate"
            @play="handleVideoPlay"
            @pause="handleVideoPause"
            @ended="handleVideoEnded"
            @error="handleMediaError"
            @buffering="transcoder.setBuffering"
            @playing="handleVideoPlaying"
            @loadedmetadata="handleLoadedMetadata"
          />
          <VideoPlayer
            v-else-if="mediaUrl"
            ref="videoPlayerRef"
            :key="(currentMediaItem?.path || '') + '-video'"
            :src="mediaUrl"
            :poster="posterUrl"
            :is-transcoding-mode="isTranscodingMode"
            :is-controls-visible="isControlsVisible"
            :is-transcoding-loading="isTranscodingLoading"
            :is-buffering="isBuffering"
            :initial-time="savedCurrentTime"
            @play="handleVideoPlay"
            @pause="handleVideoPause"
            @ended="handleVideoEnded"
            @error="handleMediaError"
            @trigger-transcode="() => tryTranscoding()"
            @buffering="transcoder.setBuffering"
            @playing="handleVideoPlaying"
            @update:video-element="handleVideoElementUpdate"
            @timeupdate="handleTimeUpdate"
            @loadedmetadata="handleLoadedMetadata"
          />
        </Transition>
      </template>
    </div>

    <!-- Media Controls -->
    <MediaControls
      class="floating-controls"
      :current-media-item="currentMediaItem"
      :is-playing="isPlaying"
      :can-navigate="canNavigate"
      :can-go-previous="canGoPrevious"
      :is-controls-visible="isControlsVisible"
      :is-image="isImage"
      :is-vr-mode="isVrMode"
      :is-opening-vlc="isOpeningVlc"
      :is-muted="isMuted"
      :current-time="currentVideoTime"
      :duration="transcodedDuration || videoElement?.duration || 0"
      :watched-segments="watchedSegments"
      @previous="handlePrevious"
      @next="handleNext"
      @toggle-play="togglePlay"
      @toggle-mute="toggleMute"
      @open-in-vlc="openInVlc"
      @set-rating="setRating"
      @toggle-vr="toggleVrMode"
      @toggle-fullscreen="toggleFullscreen"
      @seek="handleSeek"
      @scrub-start="handleScrubStart"
      @scrub-end="handleScrubEnd"
      @open-shortcuts="$emit('open-shortcuts')"
    />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import {
  ref,
  computed,
  watch,
  watchEffect,
  onMounted,
  onUnmounted,
  onBeforeUnmount,
  defineAsyncComponent,
} from 'vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useTranscoder } from '@/composables/useTranscoder';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useSlideshow } from '@/composables/useSlideshow';
import { useUIStore } from '@/composables/useUIStore';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/index';
import MenuIcon from '@/components/atoms/icons/MenuIcon.vue';
import PlaylistIcon from '@/components/atoms/icons/PlaylistIcon.vue';
import SpinnerIcon from '@/components/atoms/icons/SpinnerIcon.vue';
import VlcIcon from '@/components/atoms/icons/VlcIcon.vue';
import MediaControls from './MediaControls.vue';
import TranscodingStatus from './TranscodingStatus.vue';
import VideoPlayer from './VideoPlayer.vue';
// VRVideoPlayer + Three.js (~700KB) live in their own chunk loaded only when
// the user opens VR mode. Importing the type statically is free at runtime.
import type VRVideoPlayerType from './VRVideoPlayer.vue';
const VRVideoPlayer = defineAsyncComponent(() => import('./VRVideoPlayer.vue'));
import { isMediaFileImage } from '@/utils/mediaUtils';
import { WATCHED_THRESHOLD } from '@/utils/playbackUtils';
import {
  isActivatableTarget,
  isModalOpen,
  shouldIgnoreGlobalShortcut,
} from '@/utils/keyboardUtils';
import {
  addWatchedSegment as mergeWatchedSegment,
  parseWatchedSegments,
  type WatchedSegment,
} from '@/utils/watchedSegments';
import type { MediaFile } from '../../../core/media/types';

defineEmits(['open-shortcuts']);
const libraryStore = useLibraryStore();
const playerStore = usePlayerStore();
const playlistStore = usePlaylistStore();
const uiStore = useUIStore();
const toast = useToast();

const { imageExtensionsSet, mediaDirectories, thumbnailUrlGenerator } =
  storeToRefs(libraryStore);
const { pauseTimerOnPlay, isTimerRunning, mainVideoElement } =
  storeToRefs(playerStore);
const { currentItem: currentMediaItem } = storeToRefs(playlistStore);
const { isControlsVisible, isSourcesModalVisible, isSidebarVisible } =
  storeToRefs(uiStore);
const {
  navigateMedia,
  pauseSlideshowTimerForVideo,
  resumeSlideshowTimerAfterVideo,
  toggleSlideshowTimer,
} = useSlideshow();
const transcoder = useTranscoder();
const {
  isTranscodingMode,
  isTranscodingLoading,
  isBuffering,
  transcodedDuration,
  transcodingProgress,
  startTranscoding,
  resetTranscoderState,
  stopTranscodingProgressPoll,
} = transcoder;

const mediaLoader = useMediaLoader();
const { isLoading, mediaUrl, error, isVideoSupported, loadMedia } = mediaLoader;

const videoElement = ref<HTMLVideoElement | null>(null);
const videoPlayerRef = ref<InstanceType<typeof VideoPlayer> | null>(null);
const vrPlayerRef = ref<InstanceType<typeof VRVideoPlayerType> | null>(null);

const isVrMode = ref(false);
const savedCurrentTime = ref(0);
const isOpeningVlc = ref(false);
const isMuted = ref(false);
const isPlaying = ref(false);
/** Duration of the current item as stored in the library (0 if unknown). */
const itemDuration = ref(0);
/** Time ranges of the current item the user has played (seek bar overlay). */
const watchedSegments = ref<WatchedSegment[]>([]);
// Path whose stored segments have been loaded into watchedSegments. Saving
// replaces the stored list, so nothing is written before that load.
let segmentsOwnerPath: string | null = null;
let segmentsDirty = false;

const SEEK_STEP_S = 5;

const posterUrl = computed(() => {
  if (currentMediaItem.value && thumbnailUrlGenerator?.value) {
    try {
      return thumbnailUrlGenerator.value(currentMediaItem.value.path);
    } catch (e) {
      console.warn('Failed to generate poster URL', e);
    }
  }
  return undefined;
});

const openSourcesModal = () => {
  isSourcesModalVisible.value = true;
};

const currentVideoTime = computed({
  get: () => savedCurrentTime.value,
  set: (val) => {
    savedCurrentTime.value = val;
  },
});

onMounted(() => {
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

const isImage = computed(() => {
  return currentMediaItem.value
    ? isMediaFileImage(currentMediaItem.value, imageExtensionsSet.value)
    : false;
});

const canNavigate = computed(() => {
  return playlistStore.hasNext || playlistStore.queue.length > 0;
});

const canGoPrevious = computed(() => playlistStore.hasPrevious);

const toggleFullscreen = () => {
  if (isVrMode.value && vrPlayerRef.value) {
    vrPlayerRef.value.toggleFullscreen();
    return;
  }
  if (videoElement.value) {
    if (!document.fullscreenElement) {
      videoElement.value.requestFullscreen().catch((err: unknown) => {
        console.error('Error attempting to enable fullscreen mode:', err);
      });
    } else {
      void document.exitFullscreen();
    }
  }
};

const tryTranscoding = async (requestId?: number) => {
  const item = currentMediaItem.value;
  if (!item) return;

  // Use provided requestId or current one if not provided
  const effectiveRequestId =
    requestId !== undefined
      ? requestId
      : mediaLoader.currentLoadRequestId.value;

  try {
    const url = await startTranscoding(item.path, {
      knownDuration: itemDuration.value,
    });

    // [SECURITY] Race condition check: only update if this is still the active request
    if (
      url === null ||
      effectiveRequestId !== mediaLoader.currentLoadRequestId.value
    ) {
      return;
    }

    mediaUrl.value = url;
    isVideoSupported.value = true;
  } catch (e) {
    if (effectiveRequestId !== mediaLoader.currentLoadRequestId.value) return;
    error.value = 'Failed to start playback';
    console.error('Transcoding failed', e);
  }
};

const lastTrackedTime = ref(-1);
const lastSegmentsUpdate = ref(Date.now());
const lastPositionUpdate = ref(0);
const SEEK_DETECTION_THRESHOLD_S = 5;
const UPDATE_INTERVAL_MS = 5000;
const POSITION_PERSIST_INTERVAL_MS = 5000;

// Position/segment writes still in flight, by path. Opening a file first
// waits for its own pending writes, so the metadata read returns what was
// just saved (e.g. when going back to the previous item).
const pendingWrites = new Map<string, Promise<unknown>>();

const trackWrite = (filePath: string, write: Promise<void>) => {
  const all = Promise.all([pendingWrites.get(filePath), write]);
  pendingWrites.set(filePath, all);
  void all.finally(() => {
    if (pendingWrites.get(filePath) === all) pendingWrites.delete(filePath);
  });
  return write;
};

const handleTimeUpdate = (time: number) => {
  // Until the new item's URL is known only the previous, already reset
  // player can report a time (e.g. 0 after releasing its source). It is not
  // the new item's position and must not be saved under its path.
  if (!mediaUrl.value) return;
  savedCurrentTime.value = time;

  const item = currentMediaItem.value;
  if (!isPlaying.value || !item) return;

  if (lastTrackedTime.value === -1) {
    lastTrackedTime.value = time;
  } else {
    const delta = Math.abs(time - lastTrackedTime.value);
    if (delta > 0 && delta < SEEK_DETECTION_THRESHOLD_S) {
      addWatchedSegment(
        Math.min(lastTrackedTime.value, time),
        Math.max(lastTrackedTime.value, time),
      );
    }
    lastTrackedTime.value = time;
  }

  const now = Date.now();
  if (now - lastSegmentsUpdate.value > UPDATE_INTERVAL_MS) {
    lastSegmentsUpdate.value = now;
    void persistWatchedSegments(item.path);
  }

  if (now - lastPositionUpdate.value > POSITION_PERSIST_INTERVAL_MS) {
    lastPositionUpdate.value = now;
    void persistPlaybackPosition(item.path, time);
  }
};

const addWatchedSegment = (start: number, end: number) => {
  watchedSegments.value = mergeWatchedSegment(watchedSegments.value, {
    start,
    end,
  });
  segmentsDirty = true;
};

/**
 * Saves the watched segments of `filePath`. They are only written while they
 * belong to that file and after its stored segments were loaded, because
 * the write replaces the stored list.
 */
const persistWatchedSegments = (filePath: string): Promise<void> => {
  if (segmentsOwnerPath !== filePath || !segmentsDirty) {
    return Promise.resolve();
  }
  segmentsDirty = false;
  const json = JSON.stringify(watchedSegments.value);
  return trackWrite(
    filePath,
    (async () => {
      try {
        await api.updateWatchedSegments(filePath, json);
      } catch (e) {
        console.error('Failed to persist segments', e);
      }
    })(),
  );
};

const persistPlaybackPosition = (
  filePath: string,
  position: number,
): Promise<void> => {
  if (!Number.isFinite(position) || position < 0) return Promise.resolve();
  return trackWrite(
    filePath,
    (async () => {
      try {
        await api.updatePlaybackPosition(filePath, position);
      } catch (e) {
        console.warn('Failed to persist playback position', e);
      }
    })(),
  );
};

/** Saves the final position and watched segments of `item` under its own path. */
const persistItemState = (item: MediaFile) => {
  void persistWatchedSegments(item.path);
  if (
    !isMediaFileImage(item, imageExtensionsSet.value) &&
    Number.isFinite(savedCurrentTime.value) &&
    savedCurrentTime.value > 0
  ) {
    void persistPlaybackPosition(item.path, savedCurrentTime.value);
  }
};

onBeforeUnmount(() => {
  if (currentMediaItem.value) persistItemState(currentMediaItem.value);
  stopTranscodingProgressPoll();
});

watch(
  currentMediaItem,
  async (newItem, oldItem, onCleanup) => {
    // A stale invocation resuming after an await must not touch state:
    // calling loadMedia here would bump currentLoadRequestId and clobber
    // the newer item's mediaUrl.
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });

    // Synchronously invalidate the previous item's URL and in-flight load,
    // so it can neither play under the new item's key nor be applied to it
    // while the new item's metadata is loading.
    mediaLoader.cancelPendingLoad();

    // Persist the previous file's final state under its own path, before
    // any per-item state below is reset for the new item.
    if (oldItem) persistItemState(oldItem);

    // Finish the old item's playback here: its player unmounts in this flush
    // (mediaUrl was just cleared), so the 'pause' queued by reset() below is
    // dropped and handleVideoPause never runs. The position it would persist
    // is already covered by persistItemState.
    if (isPlaying.value) {
      isPlaying.value = false;
      if (pauseTimerOnPlay.value) resumeSlideshowTimerAfterVideo();
    }

    lastTrackedTime.value = -1;
    lastPositionUpdate.value = 0;
    lastSegmentsUpdate.value = Date.now();
    savedCurrentTime.value = 0;
    itemDuration.value = 0;
    watchedSegments.value = [];
    segmentsOwnerPath = null;
    segmentsDirty = false;
    resetTranscoderState();
    const activePlayer = isVrMode.value
      ? vrPlayerRef.value
      : videoPlayerRef.value;
    if (activePlayer) {
      activePlayer.reset();
    } else if (videoElement.value) {
      videoElement.value.pause();
      videoElement.value.removeAttribute('src');
      videoElement.value.load();
    }

    if (newItem) {
      const isVideo = !isMediaFileImage(newItem, imageExtensionsSet.value);
      if (isVideo) {
        try {
          // Read back what was just saved for this file (e.g. going back).
          const pending = pendingWrites.get(newItem.path);
          if (pending) await pending;
          if (cancelled) return;
          const meta = await api.getMetadata([newItem.path]);
          if (cancelled) return;
          const saved = meta[newItem.path]?.playbackPosition;
          const duration =
            meta[newItem.path]?.duration ?? newItem.duration ?? 0;
          if (Number.isFinite(duration) && duration > 0) {
            itemDuration.value = duration;
          }
          // Resume only if there's a non-trivial saved position and we
          // haven't crossed the shared watched threshold (which would
          // restart the file from the beginning to match the WATCHED
          // badge in MediaGridItem).
          if (
            typeof saved === 'number' &&
            saved > 5 &&
            (duration === 0 || saved / duration < WATCHED_THRESHOLD)
          ) {
            savedCurrentTime.value = saved;
          }
          watchedSegments.value = parseWatchedSegments(
            meta[newItem.path]?.watchedSegments,
          );
          segmentsOwnerPath = newItem.path;
        } catch (e) {
          console.warn('Failed to load saved playback position', e);
        }
      }

      if (cancelled) return;
      await loadMedia(newItem, (_, reqId) => tryTranscoding(reqId));
    } else {
      mediaUrl.value = null;
    }
  },
  { immediate: true },
);

const handleVideoElementUpdate = (el: HTMLVideoElement | null) => {
  videoElement.value = el;
  mainVideoElement.value = el;
};

watchEffect(() => {
  if (videoElement.value) {
    videoElement.value.muted = isMuted.value;
  }
});

const toggleMute = () => {
  isMuted.value = !isMuted.value;
};

const handleVideoEnded = () => {
  if (!isLoading.value) {
    // With "pause timer on play" the countdown is paused while a video plays,
    // and the 'pause' fired right before 'ended' has just resumed it: a
    // running timer then doesn't mean the video is shorter than the timer.
    if (isTimerRunning.value && !pauseTimerOnPlay.value) {
      // If timer is still running, the video is shorter than the timer duration.
      // We should loop the video until the timer finishes.
      if (videoElement.value) {
        videoElement.value.currentTime = 0;
        videoElement.value.play().catch(() => {});
      }
    } else {
      // If the video was longer than the timer (and thus paused it), or if we're
      // just playing a single video, advance to next.
      navigateMedia(1);
    }
  }
};

const handleVideoPlay = () => {
  checkAndPauseTimerIfLongVideo();
  isPlaying.value = true;
};

const handleLoadedMetadata = () => {
  checkAndPauseTimerIfLongVideo();
};

const checkAndPauseTimerIfLongVideo = () => {
  if (isTimerRunning.value) {
    if (pauseTimerOnPlay.value) {
      // Always pause if user explicitly wants timer paused on play
      pauseSlideshowTimerForVideo();
    } else {
      const nativeDuration = videoElement.value?.duration || 0;
      const videoDuration = transcodedDuration.value || nativeDuration;

      if (videoDuration > playerStore.timerDuration) {
        pauseSlideshowTimerForVideo();
      }
    }
  }
};

// A transcoded file's real duration usually arrives after 'play' and
// 'loadedmetadata', which only saw the growing live playlist's length.
// Only re-check while the video is actually playing: startTranscoding sets the
// known duration before anything plays, and pausing the timer then would stall
// the slideshow on a stream that never starts (no 'play', so no resuming
// 'pause'). handleVideoPlay runs the check itself once playback begins.
watch(transcodedDuration, (duration) => {
  if (duration > 0 && !isImage.value && isPlaying.value) {
    checkAndPauseTimerIfLongVideo();
  }
});

const handleVideoPause = () => {
  if (!isTimerRunning.value && pauseTimerOnPlay.value && !isLoading.value) {
    resumeSlideshowTimerAfterVideo();
  }
  isPlaying.value = false;
  const item = currentMediaItem.value;
  if (
    item &&
    !isImage.value &&
    Number.isFinite(savedCurrentTime.value) &&
    savedCurrentTime.value > 0
  ) {
    void persistPlaybackPosition(item.path, savedCurrentTime.value);
    lastPositionUpdate.value = Date.now();
  }
};

const handleVideoPlaying = () => {
  transcoder.handlePlaybackStarted();
};

const openInVlc = async () => {
  if (!currentMediaItem.value) return;
  if (isOpeningVlc.value) return;

  isOpeningVlc.value = true;

  if (videoElement.value) {
    videoElement.value.pause();
  }

  try {
    const result = await api.openInVlc(currentMediaItem.value.path);
    if (!result.success) {
      error.value = result.message || 'Failed to open in VLC.';
    }
  } finally {
    isOpeningVlc.value = false;
  }
};

const toggleVrMode = () => {
  isVrMode.value = !isVrMode.value;
};

const togglePlay = () => {
  // In VR mode the VR player owns its own (off-DOM) video element.
  if (isVrMode.value) {
    vrPlayerRef.value?.togglePlay();
    return;
  }
  videoPlayerRef.value?.togglePlay();
};

/** Longest position a seek may target (0 while unknown). */
const getSeekableDuration = (el: HTMLVideoElement) => {
  if (transcodedDuration.value > 0) return transcodedDuration.value;
  return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
};

/**
 * Seeks the active player. A transcoded file is one HLS stream with an
 * absolute timeline from 0, so it is seeked natively as well.
 */
const seekTo = (time: number) => {
  const el = videoElement.value;
  if (!el || !Number.isFinite(time)) return;
  const duration = getSeekableDuration(el);
  el.currentTime = Math.max(0, duration > 0 ? Math.min(time, duration) : time);
};

const seekBy = (delta: number) => {
  const el = videoElement.value;
  if (!el || getSeekableDuration(el) <= 0) return;
  seekTo(el.currentTime + delta);
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
  // Keys typed into fields, browser chords and anything aimed at an open
  // dialog (lock screen, settings modals) are not player shortcuts.
  if (shouldIgnoreGlobalShortcut(event) || isModalOpen()) return;

  switch (event.code) {
    case 'Space':
      // A focused button, link or checkbox activates itself on Space.
      if (isActivatableTarget(event.target)) return;
      event.preventDefault();
      if (isImage.value) {
        toggleSlideshowTimer();
      } else {
        togglePlay();
      }
      break;
    case 'ArrowRight':
      event.preventDefault();
      seekBy(SEEK_STEP_S);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      seekBy(-SEEK_STEP_S);
      break;
  }
};

const handleMediaError = () => {
  if (isImage.value) {
    error.value = 'Failed to load image.';
    return;
  }

  if (!isTranscodingMode.value) {
    console.log('Media playback error, attempting auto-transcode...');
    void tryTranscoding();
  } else {
    // Direct play and the HLS transcode both failed: show the "not
    // supported" panel, which offers VLC and another transcoding attempt.
    isTranscodingLoading.value = false;
    isBuffering.value = false;
    stopTranscodingProgressPoll();
    isVideoSupported.value = false;
  }
};

const handlePrevious = () => {
  navigateMedia(-1);
};

const handleNext = () => {
  navigateMedia(1);
};

const setRating = async (rating: number) => {
  const item = currentMediaItem.value;
  if (!item) return;

  const previousRating = item.rating;
  const newRating = previousRating === rating ? 0 : rating;
  // Optimistic update, rolled back below if saving fails.
  item.rating = newRating;

  try {
    await api.setRating(item.path, newRating);
    if (newRating > 0) {
      toast.success(`Rated ${newRating} stars`);
    } else {
      toast.info('Rating cleared');
    }
  } catch (e) {
    // Only roll back if no newer rating was applied in the meantime.
    if (item.rating === newRating) {
      item.rating = previousRating;
    }
    console.error('Failed to set rating', e);
    toast.error('Failed to set rating. Please try again.');
  }
};

const handleSeek = (time: number) => {
  seekTo(time);
};

const handleScrubStart = () => {
  // Optional: Pause while scrubbing?
};

const handleScrubEnd = () => {
  // Optional: Resume if paused?
};

defineExpose({
  isTranscodingMode,
  isTranscodingLoading,
  transcodedDuration,
  currentVideoTime,
  isBuffering,
  videoElement,
  tryTranscoding,
  togglePlay,
});
</script>

<style scoped>
.media-display-area {
  border: none;
  background-color: transparent;
  width: 100%;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.media-display-area video,
.media-display-area img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 12px;
}

/* .glass-button comes from main.css (@layer components). Don't redefine it
 * here: a scoped copy is unlayered and would override the utilities on the
 * buttons (bg-accent, text-accent, ...). */

.media-fade-enter-active,
.media-fade-leave-active {
  transition: opacity 0.3s ease;
}

.media-fade-enter-from,
.media-fade-leave-to {
  opacity: 0;
}

.glass-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.glass-toggle:hover {
  background: rgba(0, 0, 0, 0.6);
  color: var(--text-color);
  border-color: rgba(255, 255, 255, 0.3);
}

.glass-toggle:has(input:checked) {
  background: rgba(99, 102, 241, 0.2);
  border-color: var(--accent-color);
  color: white;
  box-shadow: 0 0 15px rgba(99, 102, 241, 0.3);
}

.glass-toggle input {
  accent-color: var(--accent-color);
  width: 1.1em;
  height: 1.1em;
}

.transition-transform-opacity {
  transition-property: transform, opacity;
}

.will-change-transform {
  will-change: transform, opacity;
}
</style>
