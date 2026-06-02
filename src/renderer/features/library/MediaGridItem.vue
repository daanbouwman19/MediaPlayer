<template>
  <button
    type="button"
    class="relative group grid-item cursor-pointer w-full h-full text-left bg-transparent border-0 p-0 block focus:outline-none focus:ring-2 focus:ring-accent rounded overflow-hidden"
    :aria-label="ariaLabel"
    :title="displayName"
    @click="$emit('click', item, $event)"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @focus="handleMouseEnter"
    @blur="handleMouseLeave"
  >
    <!-- Skeleton Loader -->
    <div
      v-if="showSkeleton"
      class="absolute inset-0 bg-accent/10 animate-pulse rounded z-10 flex items-center justify-center text-muted"
    >
      <component
        :is="isVideo ? PlayIcon : ImageIcon"
        class="w-8 h-8 opacity-50"
        aria-hidden="true"
      />
    </div>

    <template v-if="isImage">
      <div
        v-if="hasFailed"
        class="h-full w-full flex items-center justify-center bg-black/5 text-muted rounded"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-12 w-12"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
      </div>
      <!-- Bolt Optimization: Removed loading="lazy" because this component is used inside a VirtualScroller.
           The scroller manages visibility (mounting/unmounting), so we want images in the buffer
           to load immediately (eagerly) rather than waiting for the browser's lazy load threshold. -->
      <img
        v-if="!hasFailed"
        :src="mediaUrl"
        alt=""
        class="h-full w-full object-cover rounded transition-opacity duration-300"
        :class="{ 'opacity-0': isLoading }"
        @load="isLoading = false"
        @error="handleImageError"
      />
    </template>
    <template v-else-if="isVideo">
      <!-- Palette: Hover-to-Play Preview -->
      <video
        v-if="shouldPlayPreview && !videoPreviewFailed"
        :src="mediaUrl"
        :poster="posterUrl"
        muted
        autoplay
        loop
        playsinline
        class="h-full w-full object-cover rounded block"
        @error="handleVideoError"
      ></video>
      <!-- Fallback: Video Player if Poster Failed (but try preview logic first) -->
      <video
        v-else-if="(!posterUrl || posterFailed) && !videoPreviewFailed"
        :src="mediaUrl"
        :poster="posterUrl"
        muted
        preload="metadata"
        class="h-full w-full object-cover rounded block"
        @error="handleVideoError"
      ></video>
      <!-- Bolt Optimization: Use img for video thumbnails to save memory/CPU -->
      <img
        v-else
        :src="posterUrl"
        class="h-full w-full object-cover rounded block transition-opacity duration-300"
        :class="{ 'opacity-0': isLoading }"
        @load="isLoading = false"
        @error="handlePosterError"
      />
      <div
        class="absolute top-2 right-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded flex items-center pointer-events-none"
      >
        {{ item.duration ? formatTime(item.duration) : 'VIDEO' }}
      </div>
    </template>
    <div
      v-if="item.rating"
      class="absolute top-2 left-2 bg-black/60 text-accent text-xs px-1.5 py-0.5 rounded flex items-center pointer-events-none gap-1"
    >
      <StarIcon class="w-3 h-3 fill-current" />
      {{ item.rating }}
    </div>
    <div
      v-if="isDrive"
      class="absolute top-2 z-30 transition-all duration-200"
      :class="item.rating ? 'left-12' : 'left-2'"
    >
      <button
        v-if="cacheStatus === 'cloud'"
        type="button"
        class="bg-black/60 hover:bg-accent hover:text-black text-white p-1 rounded-full flex items-center justify-center pointer-events-auto transition-all scale-100 hover:scale-110 active:scale-95"
        title="Download to offline cache"
        aria-label="Download to offline cache"
        @click.stop="triggerOfflineDownload"
      >
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M12 9.75v6.75m0 0l-3-3m3 3l3-3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
          />
        </svg>
      </button>
      <div
        v-else-if="cacheStatus === 'syncing'"
        class="bg-black/60 text-accent p-1 rounded-full flex items-center justify-center pointer-events-none"
        :title="`Syncing: ${Math.round(cacheProgress * 100)}%`"
      >
        <svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="3"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      </div>
      <div
        v-else-if="cacheStatus === 'ready'"
        class="bg-green-600/90 text-white p-1 rounded-full flex items-center justify-center pointer-events-none shadow-md"
        title="Ready Offline"
      >
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="3"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M4.5 12.75l6 6 9-13.5"
          />
        </svg>
      </div>
    </div>
    <div
      v-if="isWatched"
      class="absolute top-2 right-2 -translate-y-0.5 bg-green-600/90 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 pointer-events-none"
      title="Watched"
      aria-label="Watched"
    >
      <svg
        class="w-2.5 h-2.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="3"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
      WATCHED
    </div>
    <div
      class="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 pointer-events-none"
    >
      <p class="text-white text-xs truncate">
        {{ displayName }}
      </p>
    </div>
    <!-- Selection overlay — stable border, no box-shadow flicker -->
    <div
      v-if="isSelected"
      class="absolute inset-0 rounded border-2 border-accent pointer-events-none z-20"
      aria-hidden="true"
    />
    <!-- Transcode status badge -->
    <div
      v-if="transcodeStatus"
      class="absolute bottom-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded text-white text-[10px] font-semibold leading-none pointer-events-none"
      :class="{
        'bg-gray-600/90': transcodeStatus === 'pending',
        'bg-blue-600/90': transcodeStatus === 'processing',
        'bg-green-600/90': transcodeStatus === 'done',
        'bg-red-600/90': transcodeStatus === 'failed',
      }"
      :title="`Transcode: ${transcodeStatus}`"
    >
      <svg
        v-if="transcodeStatus === 'pending'"
        class="w-2.5 h-2.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <svg
        v-else-if="transcodeStatus === 'processing'"
        class="w-2.5 h-2.5 shrink-0 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      <svg
        v-else-if="transcodeStatus === 'done'"
        class="w-2.5 h-2.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M5 13l4 4L19 7"
        />
      </svg>
      <svg
        v-else-if="transcodeStatus === 'failed'"
        class="w-2.5 h-2.5 shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
      <span>{{
        transcodeStatus === 'processing' ? 'HLS' : transcodeStatus
      }}</span>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import type { MediaFile, TranscodeJob } from '../../../core/media/types';
import {
  getDisplayName,
  isMediaFileImage,
  isMediaFileVideo,
} from '@/utils/mediaUtils';
import { formatTime, formatDurationForA11y } from '@/utils/timeUtils';
import { isWatched as isWatchedThreshold } from '@/utils/playbackUtils';
import ImageIcon from '@/components/atoms/icons/ImageIcon.vue';
import PlayIcon from '@/components/atoms/icons/PlayIcon.vue';
import StarIcon from '@/components/atoms/icons/StarIcon.vue';

const props = defineProps<{
  item: MediaFile;
  imageExtensionsSet: Set<string>;
  videoExtensionsSet: Set<string>;
  mediaUrlGenerator: ((path: string) => string) | null;
  thumbnailUrlGenerator: ((path: string) => string) | null;
  failedImagePaths: Set<string>;
  isSelected?: boolean;
  transcodeStatus?: TranscodeJob['status'];
}>();

defineEmits<{
  (e: 'click', item: MediaFile, event: MouseEvent): void;
  (e: 'image-error', item: MediaFile): void;
}>();

// Optimization: Removed defensive coding that checked for wrapped Refs.
// Props are guaranteed to be unwrapped Sets by Vue and strict typing.
const isImage = computed(() =>
  isMediaFileImage(props.item, props.imageExtensionsSet),
);

const isVideo = computed(() =>
  isMediaFileVideo(props.item, props.videoExtensionsSet),
);

const isWatched = computed(() => {
  if (!isVideo.value) return false;
  return isWatchedThreshold(props.item.playbackPosition, props.item.duration);
});

const mediaUrl = computed(() => {
  if (!props.mediaUrlGenerator) return '';
  if (isVideo.value) {
    return props.mediaUrlGenerator(props.item.path) + '#t=0.001';
  } else if (isImage.value && props.thumbnailUrlGenerator) {
    return props.thumbnailUrlGenerator(props.item.path);
  }
  return props.mediaUrlGenerator(props.item.path);
});

const posterUrl = computed(() => {
  if (props.thumbnailUrlGenerator) {
    return props.thumbnailUrlGenerator(props.item.path);
  }
  return '';
});

const displayName = computed(() => getDisplayName(props.item));

const ariaLabel = computed(() => {
  const parts = [`View ${displayName.value}`];

  if (isVideo.value) {
    parts.push('Video');
    if (props.item.duration) {
      parts.push(formatDurationForA11y(props.item.duration));
    }
  } else if (isImage.value) {
    parts.push('Image');
  }

  if (props.item.rating) {
    parts.push(
      `Rated ${props.item.rating} star${props.item.rating === 1 ? '' : 's'}`,
    );
  }

  return parts.join(', ');
});

const hasFailed = computed(() => props.failedImagePaths.has(props.item.path));

const showSkeleton = computed(() => {
  if (!isLoading.value) return false;
  if (isImage.value) {
    return !hasFailed.value;
  }
  if (isVideo.value) {
    return !!posterUrl.value && !posterFailed.value;
  }
  return false;
});

const handleImageError = (event: Event) => {
  if (!props.mediaUrlGenerator || hasFailed.value) return;

  const imgElement = event.target as HTMLImageElement;
  const rawFullUrl = props.mediaUrlGenerator(props.item.path);
  const fullUrlResolved = new URL(rawFullUrl, window.location.href).href;

  if (imgElement.src !== fullUrlResolved && mediaUrl.value !== rawFullUrl) {
    // Retry with full URL
    imgElement.src = rawFullUrl;
  } else {
    // Already tried full URL or it matches, so it's a real failure
    // We cannot mutate the prop, so we should rely on the parent updating the set
    props.failedImagePaths.add(props.item.path);
  }
};

const posterFailed = ref(false);
const isLoading = ref(true);

const handlePosterError = () => {
  posterFailed.value = true;
  isLoading.value = false; // Stop loading if poster fails so video can show
};

// Reset posterFailed when item changes (RecycleScroller reuse)
watch(
  () => props.item.path,
  () => {
    posterFailed.value = false;
    videoPreviewFailed.value = false;
    isLoading.value = true;
    isHovered.value = false;
  },
);

const PREVIEW_DEBOUNCE_MS = 500;
const isHovered = ref(false);
const videoPreviewFailed = ref(false);
let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

const handleMouseEnter = () => {
  if (hoverTimeout) clearTimeout(hoverTimeout);
  hoverTimeout = setTimeout(() => {
    isHovered.value = true;
  }, PREVIEW_DEBOUNCE_MS);
};

const handleMouseLeave = () => {
  if (hoverTimeout) clearTimeout(hoverTimeout);
  isHovered.value = false;
};

const handleVideoError = () => {
  // If the video fails to load/play, stop trying to preview it
  videoPreviewFailed.value = true;
  // If we were relying on the video because the poster failed, and the video ALSO failed,
  // we effectively have a double failure. The UI might just show a broken state or the poster error state.
  // If the poster hasn't failed yet, this will trigger the v-else to show the poster.
};

const shouldPlayPreview = computed(() => isHovered.value && isVideo.value);

// Offline Drive Caching logic

const isDrive = computed(() => props.item.path.startsWith('gdrive://'));
const cacheStatus = ref<'ready' | 'syncing' | 'cloud'>('cloud');
const cacheProgress = ref(0);
let unsubscribeProgress: (() => void) | null = null;

const fetchCacheStatus = async () => {
  if (!isDrive.value) return;
  try {
    const fileId = props.item.path.slice('gdrive://'.length);
    const res = await window.electronAPI.getDriveCacheStatus(fileId);
    if (res && res.success && res.data) {
      cacheStatus.value = res.data.status;
      cacheProgress.value = res.data.progress;
    }
  } catch (err) {
    console.error('Failed to get cache status:', err);
  }
};

const subscribeToProgress = () => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
    unsubscribeProgress = null;
  }
  if (!window.electronAPI?.onDriveCacheProgress) return;
  unsubscribeProgress = window.electronAPI.onDriveCacheProgress(
    (_event, data) => {
      const fileId = props.item.path.slice('gdrive://'.length);
      if (data.fileId === fileId) {
        cacheStatus.value = data.progress >= 1 ? 'ready' : 'syncing';
        cacheProgress.value = data.progress;
      }
    },
  );
};

const triggerOfflineDownload = async () => {
  if (!isDrive.value || cacheStatus.value !== 'cloud') return;
  cacheStatus.value = 'syncing';
  cacheProgress.value = 0;
  try {
    const fileId = props.item.path.slice('gdrive://'.length);
    await window.electronAPI.triggerDriveCache(fileId);
  } catch (err) {
    console.error('Failed to trigger cache download:', err);
    cacheStatus.value = 'cloud';
  }
};

// Reset/re-fetch on path change
watch(
  () => props.item.path,
  () => {
    posterFailed.value = false;
    videoPreviewFailed.value = false;
    isLoading.value = true;
    isHovered.value = false;
    if (isDrive.value) {
      fetchCacheStatus();
      subscribeToProgress();
    } else {
      cacheStatus.value = 'cloud';
      cacheProgress.value = 0;
    }
  },
);

onMounted(() => {
  if (isDrive.value) {
    fetchCacheStatus();
    subscribeToProgress();
  }
});

onUnmounted(() => {
  if (unsubscribeProgress) {
    unsubscribeProgress();
  }
});
</script>

<style scoped>
.grid-item {
  /* Enable GPU acceleration */
  will-change: transform;
  transform: translateZ(0);

  /* Optimize rendering */
  backface-visibility: hidden;
  -webkit-font-smoothing: antialiased;
}

/* Simplified hover effect - no transitions */
.grid-item:hover {
  border-color: var(--accent-color);
}

/* Optimize image rendering */
.grid-item img,
.grid-item video {
  /* Force GPU acceleration */
  transform: translateZ(0);

  /* Optimize image rendering */
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
}
</style>
