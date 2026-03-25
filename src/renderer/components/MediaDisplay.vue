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
        :transcoded-duration="transcodedDuration"
        :current-transcode-start-time="currentTranscodeStartTime"
        :progress="transcodingProgress"
      />

      <!-- 2. Placeholder (No Item & Not Loading) -->
      <div
        v-if="!currentMediaItem && !isLoading"
        class="flex flex-col items-center justify-center p-6 text-center z-10"
      >
        <template v-if="mediaDirectories.length === 0">
          <div class="mb-4 p-4 rounded-full bg-indigo-500/10 text-indigo-400">
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
          <h2 class="text-2xl font-bold text-white mb-2">
            Welcome to Media Player
          </h2>
          <p class="text-gray-400 mb-6 max-w-md">
            Your library is currently empty. Add a folder to start enjoying your
            media collection.
          </p>
          <button
            class="glass-button px-6 py-3 flex items-center gap-2 font-semibold text-white bg-indigo-600/80 hover:bg-indigo-600 border-indigo-500/50"
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
            class="flex flex-col items-center gap-3 text-gray-500 opacity-60"
            role="status"
            aria-live="polite"
          >
            <PlaylistIcon class="w-16 h-16 opacity-50" aria-hidden="true" />
            <p class="text-lg font-medium">Select an album to start playback</p>
            <button
              v-if="!isSidebarVisible"
              class="glass-button px-4 py-2 mt-2 flex items-center gap-2 text-sm font-medium text-indigo-300 hover:text-white transition-colors"
              @click="isSidebarVisible = true"
            >
              <MenuIcon class="w-4 h-4" aria-hidden="true" />
              Open Library
            </button>
            <p v-else class="text-sm">Choose from the sidebar to begin</p>
            <p class="text-xs mt-4 text-gray-600">
              Press
              <kbd
                class="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 font-mono text-gray-400"
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

      <!-- 4. Unsupported Format Message (Only if not loading/transcoding) -->
      <div
        v-else-if="!isVideoSupported && !isImage && !isTranscodingMode"
        class="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 p-6 text-center"
      >
        <p class="text-lg md:text-xl font-bold text-red-400 mb-2">
          Video Format Not Supported
        </p>
        <p class="text-gray-300 mb-4 text-sm md:text-base">
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
          v-if="!isTranscodingMode"
          class="glass-button px-6 py-3 flex items-center gap-2 mt-2"
          @click="() => tryTranscoding(0)"
        >
          Try Transcoding
        </button>
      </div>

      <!-- 5. Media Content -->
      <template v-else>
        <Transition v-if="mediaUrl" name="media-fade" mode="out-in">
          <img
            v-if="displayedIsImage"
            :key="(displayedItem?.path || '') + '-img'"
            :src="mediaUrl"
            :alt="displayedItem?.name"
            @load="handleImageLoad"
            @error="handleImageError"
          />
          <VRVideoPlayer
            v-else-if="isVrMode"
            ref="vrPlayerRef"
            :key="(displayedItem?.path || '') + '-vr'"
            :src="mediaUrl"
            :poster="posterUrl"
            :is-playing="isPlaying"
            :initial-time="savedCurrentTime"
            :is-controls-visible="isControlsVisible"
            @timeupdate="handleTimeUpdate"
            @update:video-element="handleVideoElementUpdate"
            @play="handleVideoPlay"
            @pause="handleVideoPause"
          />
          <VideoPlayer
            v-else
            ref="videoPlayerRef"
            :key="(displayedItem?.path || '') + '-video'"
            :src="mediaUrl"
            :poster="posterUrl"
            :is-transcoding-mode="isTranscodingMode"
            :is-controls-visible="isControlsVisible"
            :transcoded-duration="transcodedDuration"
            :current-transcode-start-time="currentTranscodeStartTime"
            :is-transcoding-loading="isTranscodingLoading"
            :is-buffering="isBuffering"
            :initial-time="savedCurrentTime"
            :file-path="displayedItem?.path"
            @play="handleVideoPlay"
            @pause="handleVideoPause"
            @ended="handleVideoEnded"
            @error="handleMediaError"
            @trigger-transcode="tryTranscoding"
            @buffering="handleBuffering"
            @playing="handleVideoPlaying"
            @update:video-element="handleVideoElementUpdate"
            @timeupdate="handleTimeUpdate"
          />
        </Transition>
      </template>
    </div>

    <!-- Media Controls -->
    <MediaControls
      ref="mediaControlsRef"
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
/**
 * @file This component is responsible for displaying the current media item (image or video).
 * It handles loading the media from the main process, displaying loading/error states,
 * and providing navigation controls to move between media items.
 */
import {
  ref,
  computed,
  watch,
  watchEffect,
  onMounted,
  onUnmounted,
  onBeforeUnmount,
} from 'vue';
import { useLibraryStore } from '../composables/useLibraryStore';
import { usePlayerStore } from '../composables/usePlayerStore';
import { useSlideshow } from '../composables/useSlideshow';
import { useUIStore } from '../composables/useUIStore';
import { useToast } from '../composables/useToast';
import { api } from '../api';
import MenuIcon from './icons/MenuIcon.vue';
import PlaylistIcon from './icons/PlaylistIcon.vue';
import SpinnerIcon from './icons/SpinnerIcon.vue';
import VlcIcon from './icons/VlcIcon.vue';
import MediaControls from './MediaControls.vue';
import TranscodingStatus from './TranscodingStatus.vue';
import VideoPlayer from './VideoPlayer.vue';
import VRVideoPlayer from './VRVideoPlayer.vue'; // [NEW]
import type { MediaFile } from '../../core/types';
import { LEGACY_VIDEO_EXTENSIONS } from '../../core/constants';
import { isMediaFileImage, isMediaFileVideo } from '../utils/mediaUtils';

defineEmits(['open-shortcuts']);

const libraryStore = useLibraryStore();
const playerStore = usePlayerStore();
const uiStore = useUIStore();
const toast = useToast();

const {
  imageExtensionsSet,
  videoExtensionsSet,
  mediaDirectories,
  mediaUrlGenerator,
  thumbnailUrlGenerator,
} = libraryStore;

const {
  currentMediaItem,
  displayedMediaFiles,
  currentMediaIndex,
  playFullVideo,
  pauseTimerOnPlay,
  isTimerRunning,
  mainVideoElement,
  isLoading,
} = playerStore;

const {
  navigateMedia,
  pauseSlideshowTimer,
  resumeSlideshowTimer,
  toggleSlideshowTimer,
} = useSlideshow();

/**
 * The URL of the media to be displayed (can be a Data URL or an HTTP URL).
 */
const mediaUrl = ref<string | null>(null);

/**
 * A string to hold any error message that occurs during media loading.
 */
const error = ref<string | null>(null);

const displayedItem = ref<MediaFile | null>(null);

/**
 * A computed property that determines if the displayed media item is an image.
 */
const displayedIsImage = computed(() => {
  return (
    !!displayedItem.value &&
    isMediaFileImage(displayedItem.value, imageExtensionsSet.value)
  );
});

/**
 * Handles image load completion to clear loading state and start timer.
 */
const handleImageLoad = () => {
  isLoading.value = false;
  // If we are in a slideshow, start/resume the timer now that image is visible
  if (isTimerRunning.value) {
    resumeSlideshowTimer();
  }
};

/**
 * Handles image load errors.
 */
const handleImageError = () => {
  isLoading.value = false;
  error.value = 'Failed to load image.';
  // Pause the timer on error so the user can see it
  if (isTimerRunning.value) {
    pauseSlideshowTimer();
  }
};

/**
 * Reference to the video element.
 */
const videoElement = ref<HTMLVideoElement | null>(null);
const videoPlayerRef = ref<InstanceType<typeof VideoPlayer> | null>(null);
const vrPlayerRef = ref<InstanceType<typeof VRVideoPlayer> | null>(null);

const isVideoSupported = ref(true);
const isTranscodingMode = ref(false);
const isTranscodingLoading = ref(false);
const isBuffering = ref(false);
const transcodedDuration = ref(0);
const transcodingProgress = ref<number | null>(null);
const currentTranscodeStartTime = ref(0);
const isVrMode = ref(false); // [NEW]
const savedCurrentTime = ref(0); // [NEW] Sync time between players
const isOpeningVlc = ref(false);
const isMuted = ref(false);

const transcodingPollInterval = ref<NodeJS.Timeout | null>(null);

const stopTranscodingProgressPoll = () => {
  if (transcodingPollInterval.value) {
    clearInterval(transcodingPollInterval.value);
    transcodingPollInterval.value = null;
  }
};

const startTranscodingProgressPoll = (filePath: string) => {
  stopTranscodingProgressPoll();
  transcodingProgress.value = 0;

  transcodingPollInterval.value = setInterval(async () => {
    try {
      const status = await api.getHlsStatus(filePath);
      if (status) {
        transcodingProgress.value = status.percent;
        if (status.duration > 0) {
          transcodedDuration.value = status.duration;
        }
        if (status.percent >= 100) {
          isTranscodingLoading.value = false;
          isBuffering.value = false;
          stopTranscodingProgressPoll();
        }
      }
    } catch (e) {
      console.warn('Failed to poll transcoding progress', e);
    }
  }, 1000);
};

const posterUrl = computed(() => {
  if (displayedItem.value && thumbnailUrlGenerator?.value) {
    try {
      return thumbnailUrlGenerator.value(displayedItem.value.path);
    } catch (e) {
      console.warn('Failed to generate poster URL', e);
    }
  }
  return undefined;
});

// Use global controls visibility state
const { isControlsVisible, isSourcesModalVisible, isSidebarVisible } = uiStore;

const openSourcesModal = () => {
  isSourcesModalVisible.value = true;
};

const isPlaying = ref(false);
// Removed computed currentVideoTime relying on ref, using state instead
const currentVideoTime = computed({
  get: () => savedCurrentTime.value,
  set: (val) => {
    savedCurrentTime.value = val;
  },
});

const videoStreamUrlGenerator = ref<
  ((filePath: string, startTime?: number) => string) | null
>(null);

// Request tracking to prevent race conditions
let currentLoadRequestId = 0;

let videoStreamGeneratorInitPromise: Promise<
  (filePath: string, startTime?: number) => string
> | null = null;

const ensureVideoStreamGenerator = async (): Promise<
  (filePath: string, startTime?: number) => string
> => {
  if (videoStreamUrlGenerator.value) {
    return videoStreamUrlGenerator.value;
  }

  if (!videoStreamGeneratorInitPromise) {
    videoStreamGeneratorInitPromise = api
      .getVideoStreamUrlGenerator()
      .then((generator) => {
        videoStreamUrlGenerator.value = generator;
        return generator;
      })
      .catch((error) => {
        console.error('Failed to initialize video stream generator', error);
        videoStreamGeneratorInitPromise = null;
        throw error;
      });
  }

  return videoStreamGeneratorInitPromise;
};

onMounted(() => {
  ensureVideoStreamGenerator().catch(() => {
    // Already logged in ensureVideoStreamGenerator
  });
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown);
});

/**
 * A computed property that determines if the current media item is an image.
 */
const isImage = computed(() => {
  return currentMediaItem.value
    ? isMediaFileImage(currentMediaItem.value, imageExtensionsSet.value)
    : false;
});

/**
 * A computed property that determines if media navigation is possible.
 */
const canNavigate = computed(() => {
  return displayedMediaFiles.value.length > 0;
});

const canGoPrevious = computed(() => currentMediaIndex.value > 0);

/**
 * Toggles fullscreen for the video element.
 */
const toggleFullscreen = () => {
  if (isVrMode.value && vrPlayerRef.value) {
    vrPlayerRef.value.toggleFullscreen();
    return;
  }
  if (videoElement.value) {
    if (!document.fullscreenElement) {
      videoElement.value.requestFullscreen().catch((err) => {
        console.error(
          `Error attempting to enable fullscreen mode: ${err.message} (${err.name})`,
        );
      });
    } else {
      document.exitFullscreen();
    }
  }
};

/**
 * Attempts to transcode the current video file starting from a specific time.
 * @param startTime - The time to start transcoding from (in seconds).
 * @param requestId - The request ID associated with this operation (optional).
 */
const tryTranscoding = async (startTime = 0, requestId?: number) => {
  // If no specific requestId was passed, assume this is a user action and we should respect the current one,
  // OR it's a new "intent" (like a button click) which conceptually updates the state of the *current* item.
  // Ideally, button clicks on the *same* item shouldn't increment request ID, but loadMediaUrl does.
  // So we just check against currentLoadRequestId.

  if (!currentMediaItem.value) return;

  const effectiveRequestId =
    requestId !== undefined ? requestId : currentLoadRequestId;

  // Guard: If we are running part of an old request sequence, stop.
  if (effectiveRequestId !== currentLoadRequestId) return;

  // We are "transcoding" in the backend, but for the frontend player (HLS),
  // it behaves like a native stream (seekable).
  isTranscodingMode.value = true;
  isTranscodingLoading.value = true;
  error.value = null;

  currentTranscodeStartTime.value = startTime;

  try {
    // Check if item still valid
    if (effectiveRequestId !== currentLoadRequestId) return;

    // Use HLS for adaptive streaming
    const rawPath = currentMediaItem.value.path;
    const hlsUrl = await api.getHlsUrl(rawPath);

    console.log('HLS URL:', hlsUrl);
    mediaUrl.value = hlsUrl;

    // Sync displayed item when transcoding starts successfully
    displayedItem.value = currentMediaItem.value;

    isVideoSupported.value = true;

    // Start polling for progress
    startTranscodingProgressPoll(rawPath);
  } catch (e) {
    if (effectiveRequestId !== currentLoadRequestId) return;

    console.error('HLS setup failed', e);
    isTranscodingMode.value = false;
    isTranscodingLoading.value = false;
    error.value = 'Failed to start playback';
  }
};

/**
 * Asynchronously loads the URL for the current media item.
 */
const loadMediaUrl = async () => {
  // Increment ID to invalidate any pending requests
  currentLoadRequestId++;
  const requestId = currentLoadRequestId;

  if (!currentMediaItem.value) {
    mediaUrl.value = null;
    return;
  }

  isLoading.value = true;

  // Reset state flags for the new item, but KEEP mediaUrl to show old image while loading
  error.value = null;
  isVideoSupported.value = true;
  isTranscodingMode.value = false;
  isTranscodingLoading.value = false;
  isBuffering.value = false;
  transcodedDuration.value = 0;
  transcodingProgress.value = null;
  currentTranscodeStartTime.value = 0;
  stopTranscodingProgressPoll();

  // Cleanup previous video stream explicitly to prevent pending requests
  if (videoPlayerRef.value) {
    videoPlayerRef.value.reset();
  } else if (videoElement.value) {
    // Fallback if ref is not ready but element is lingering
    videoElement.value.pause();
    videoElement.value.removeAttribute('src');
    videoElement.value.load();
  }

  // Proactively transcode formats that often fail in browsers or have poor performance (e.g. MOOV at end)
  const fileName = currentMediaItem.value.name
    ? currentMediaItem.value.name.toLowerCase()
    : '';

  if (LEGACY_VIDEO_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
    console.log('Proactively transcoding legacy format:', fileName);
    await tryTranscoding(0, requestId);

    // Only turn off loading if this request is still active
    if (requestId === currentLoadRequestId) {
      isLoading.value = false;
    }
    return;
  }

  try {
    // Bolt Optimization: Use mediaUrlGenerator directly to avoid expensive IPC calls and base64 overhead.
    // This allows the browser to handle streaming, caching, and range requests efficiently.
    if (mediaUrlGenerator.value) {
      const url = mediaUrlGenerator.value(currentMediaItem.value.path);

      if (requestId !== currentLoadRequestId) return;

      const itemToLoad = currentMediaItem.value;
      mediaUrl.value = url;
      displayedItem.value = itemToLoad;
    } else {
      throw new Error('Media URL generator not ready');
    }
  } catch (err) {
    if (requestId !== currentLoadRequestId) return;

    console.error('Error loading media:', err);
    error.value = 'Failed to load media file.';
    mediaUrl.value = null;
    isLoading.value = false;
  }
};

// Watched Segments Logic
const lastTrackedTime = ref(-1);
const lastSegmentsUpdate = ref(Date.now());
const SEEK_DETECTION_THRESHOLD_S = 5;
const UPDATE_INTERVAL_MS = 5000;
const mediaControlsRef = ref<InstanceType<typeof MediaControls> | null>(null);

const handleTimeUpdate = (time: number) => {
  savedCurrentTime.value = time;

  if (!isPlaying.value || !currentMediaItem.value || !mediaControlsRef.value)
    return;

  const realCurrentTime = time;

  // Watch Tracking Logic
  if (lastTrackedTime.value === -1) {
    lastTrackedTime.value = realCurrentTime;
  } else {
    const delta = Math.abs(realCurrentTime - lastTrackedTime.value);
    if (delta > 0 && delta < SEEK_DETECTION_THRESHOLD_S) {
      addWatchedSegment(
        Math.min(lastTrackedTime.value, realCurrentTime),
        Math.max(lastTrackedTime.value, realCurrentTime),
      );
    }
    lastTrackedTime.value = realCurrentTime;
  }

  // Periodic Persist
  if (Date.now() - lastSegmentsUpdate.value > UPDATE_INTERVAL_MS) {
    persistWatchedSegments();
    lastSegmentsUpdate.value = Date.now();
  }
};

const addWatchedSegment = (start: number, end: number) => {
  if (!mediaControlsRef.value) return;
  const segments = [...mediaControlsRef.value.watchedSegments];
  segments.push({ start, end });

  // Merge overlapping
  segments.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  if (segments.length > 0) {
    let current = segments[0];
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].start <= current.end + 0.5) {
        current.end = Math.max(current.end, segments[i].end);
      } else {
        merged.push(current);
        current = segments[i];
      }
    }
    merged.push(current);
  }

  mediaControlsRef.value.watchedSegments = merged;
};

const persistWatchedSegments = async () => {
  if (!currentMediaItem.value || !mediaControlsRef.value) return;
  try {
    await api.updateWatchedSegments(
      currentMediaItem.value.path,
      JSON.stringify(mediaControlsRef.value.watchedSegments),
    );
  } catch (e) {
    console.error('Failed to persist segments', e);
  }
};

onBeforeUnmount(() => {
  persistWatchedSegments();
  stopTranscodingProgressPoll();
});

watch(currentMediaItem, () => {
  lastTrackedTime.value = -1;
});

/**
 * Toggles VR mode.
 */
const toggleVrMode = () => {
  isVrMode.value = !isVrMode.value;
};

/**
 * Toggles video playback.
 */
const togglePlay = () => {
  if (videoPlayerRef.value) {
    videoPlayerRef.value.togglePlay();
  }
};

const handleGlobalKeydown = (event: KeyboardEvent) => {
  if (event.code === 'Space') {
    event.preventDefault(); // Prevent scrolling
    if (isImage.value) {
      // If it's an image, spacebar toggles the slideshow timer (restoring App.vue behavior)
      toggleSlideshowTimer();
    } else {
      // If it's a video, spacebar toggles playback
      togglePlay();
    }
  } else if (event.code === 'ArrowRight') {
    event.preventDefault();
    if (isTranscodingMode.value) {
      if (transcodedDuration.value > 0) {
        const newTime = Math.min(
          transcodedDuration.value,
          savedCurrentTime.value + 5,
        );
        tryTranscoding(newTime);
      }
    } else if (
      videoElement.value &&
      Number.isFinite(videoElement.value.duration)
    ) {
      videoElement.value.currentTime = Math.min(
        videoElement.value.duration,
        videoElement.value.currentTime + 5,
      );
    }
  } else if (event.code === 'ArrowLeft') {
    event.preventDefault();
    if (isTranscodingMode.value) {
      if (transcodedDuration.value > 0) {
        const newTime = Math.max(0, savedCurrentTime.value - 5);
        tryTranscoding(newTime);
      }
    } else if (
      videoElement.value &&
      Number.isFinite(videoElement.value.duration)
    ) {
      videoElement.value.currentTime = Math.max(
        0,
        videoElement.value.currentTime - 5,
      );
    }
  }
};

/**
 * Handles errors from the <video> elements.
 */
const handleMediaError = () => {
  if (!isTranscodingMode.value) {
    console.log('Media playback error, attempting auto-transcode...');
    tryTranscoding(0); // Uses currentLoadRequestId implicitly
  } else {
    isLoading.value = false;
    error.value = 'Failed to display media file.';
    isTranscodingLoading.value = false;
    stopTranscodingProgressPoll();
    if (isTimerRunning.value) {
      pauseSlideshowTimer();
    }
  }
};

/**
 * Navigates to the previous media item.
 */
const handlePrevious = () => {
  navigateMedia(-1);
};

/**
 * Navigates to the next media item.
 */
const handleNext = () => {
  navigateMedia(1);
};

const setRating = async (rating: number) => {
  if (!currentMediaItem.value) return;

  const newRating = currentMediaItem.value.rating === rating ? 0 : rating;
  currentMediaItem.value.rating = newRating;

  try {
    await api.setRating(currentMediaItem.value.path, newRating);
    if (newRating > 0) {
      toast.success(`Rated ${newRating} stars`);
    } else {
      toast.info('Rating cleared');
    }
  } catch (e) {
    console.error('Failed to set rating', e);
    toast.error('Failed to set rating. Please try again.');
  }
};

// Watch for changes to the currentMediaItem and trigger a load.
watch(playFullVideo, (newValue) => {
  if (newValue) {
    pauseTimerOnPlay.value = false;
  }
});

watch(pauseTimerOnPlay, (newValue) => {
  if (newValue) {
    playFullVideo.value = false;
  }
});

/**
 * Preloads the next media item in the list if it's an image.
 * This helps eliminate loading times between slides.
 */
const preloadNextMedia = async () => {
  // 1. Identify where we are
  const currentIndex = currentMediaIndex.value;
  const list = displayedMediaFiles.value;

  // 2. Wrap around logic is handled by playerStore generally,
  // but let's just look at the next physical index for simplicity
  // or handle wrapping if we want seamless loop prefetching.
  let nextIndex = currentIndex + 1;
  if (nextIndex >= list.length) {
    nextIndex = 0; // Loop back to start
  }

  // If list is empty or single item, nothing to preload
  if (list.length <= 1) return;

  const nextItem = list[nextIndex];

  // 3. Check if it's an image
  if (isMediaFileImage(nextItem, imageExtensionsSet.value)) {
    // 4. Preload
    try {
      // Bolt Optimization: Use HTTP URL for preloading to leverage browser cache
      if (mediaUrlGenerator.value) {
        const url = mediaUrlGenerator.value(nextItem.path);
        const img = new Image();
        img.src = url;
      }
    } catch (e) {
      // Silently fail prefetching, it's an optimization only
      console.warn('Failed to preload next item', e);
    }
  } else if (
    videoExtensionsSet?.value &&
    isMediaFileVideo(nextItem, videoExtensionsSet.value)
  ) {
    // 5. Preload Video Poster
    try {
      if (thumbnailUrlGenerator?.value) {
        const url = thumbnailUrlGenerator.value(nextItem.path);
        const img = new Image();
        img.src = url;
      }
    } catch (e) {
      console.warn('Failed to preload next video thumbnail', e);
    }
  }
};

watch(
  currentMediaItem,
  (newItem) => {
    loadMediaUrl();
    // Removed immediate timer resumption.
    // It is now handled by ready events (handleImageLoad, handleVideoPlaying).

    // Trigger prefetch of the NEXT item if current item is valid
    if (newItem) {
      preloadNextMedia();
    }
  },
  { immediate: true },
);

// Sync video element with global state for ambient background
const handleVideoElementUpdate = (el: HTMLVideoElement | null) => {
  videoElement.value = el;
};
watch(videoElement, (el) => {
  mainVideoElement.value = el;
});

// Sync mute state with video element
watchEffect(() => {
  if (videoElement.value) {
    videoElement.value.muted = isMuted.value;
  }
});

const toggleMute = () => {
  isMuted.value = !isMuted.value;
};

/**
 * Handles the end of video playback.
 */
const handleVideoEnded = () => {
  // Only navigate if we are not already loading another media
  if (playFullVideo.value && !isLoading.value) {
    navigateMedia(1);
  }
};

/**
 * Handles the video play event.
 */
const handleVideoPlay = () => {
  if (isTimerRunning.value && (playFullVideo.value || pauseTimerOnPlay.value)) {
    pauseSlideshowTimer();
  }
  isPlaying.value = true;
};

/**
 * Handles the video pause event.
 */
const handleVideoPause = () => {
  // If we are loading (navigating), do NOT resume the timer.
  // The pause event here is a side-effect of resetting the player.
  if (
    !isTimerRunning.value &&
    pauseTimerOnPlay.value &&
    !playFullVideo.value &&
    !isLoading.value
  ) {
    resumeSlideshowTimer();
  }
  isPlaying.value = false;
};

/**
 * Handles the playing event to clear the loading state.
 */
const handleVideoPlaying = () => {
  isLoading.value = false;
  isTranscodingLoading.value = false;
  isBuffering.value = false;
  stopTranscodingProgressPoll();

  // If we are in a slideshow and NOT in playFullVideo mode, resume the timer now
  if (isTimerRunning.value && !playFullVideo.value) {
    resumeSlideshowTimer();
  }
};

const handleBuffering = (buffering: boolean) => {
  if (buffering) {
    if (!isTranscodingLoading.value) {
      isBuffering.value = true;
    }
  } else {
    isBuffering.value = false;
  }
};

/**
 * Opens the current media file in VLC Media Player.
 */
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

defineExpose({
  isTranscodingMode,
  isTranscodingLoading,
  transcodedDuration,
  currentVideoTime,
  currentTranscodeStartTime,
  isBuffering,
  videoElement,
  videoStreamUrlGenerator,
  tryTranscoding,
  togglePlay,
});

/**
 * Handles seeking from the progress bar.
 */
const handleSeek = (time: number) => {
  if (isTranscodingMode.value) {
    tryTranscoding(time);
  } else if (videoElement.value) {
    videoElement.value.currentTime = time;
  }
};

const handleScrubStart = () => {
  // Optional: Pause while scrubbing?
  // if (isPlaying.value) togglePlay();
};

const handleScrubEnd = () => {
  // Optional: Resume if paused?
};
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

.glass-button {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: white;
}

.glass-button:hover {
  background: rgba(255, 255, 255, 0.2);
}

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
