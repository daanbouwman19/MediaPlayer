<template>
  <button
    type="button"
    class="relative group grid-item cursor-pointer w-full h-full text-left bg-transparent border-0 p-0 block focus:outline-none focus:ring-2 focus:ring-accent rounded overflow-hidden"
    :aria-label="ariaLabel"
    :title="displayName"
    @click="$emit('click', item)"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
    @focus="handleMouseEnter"
    @blur="handleMouseLeave"
  >
    <!-- Skeleton Loader -->
    <div
      v-if="showSkeleton"
      class="absolute inset-0 bg-black/5 animate-pulse rounded z-10 flex items-center justify-center text-muted"
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
      class="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 pointer-events-none"
    >
      <p class="text-white text-xs truncate">
        {{ displayName }}
      </p>
    </div>
  </button>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MediaFile } from '../../core/types';
import {
  getDisplayName,
  isMediaFileImage,
  isMediaFileVideo,
} from '../utils/mediaUtils';
import { formatTime, formatDurationForA11y } from '../utils/timeUtils';
import ImageIcon from './icons/ImageIcon.vue';
import PlayIcon from './icons/PlayIcon.vue';
import StarIcon from './icons/StarIcon.vue';

const props = defineProps<{
  item: MediaFile;
  imageExtensionsSet: Set<string>;
  videoExtensionsSet: Set<string>;
  mediaUrlGenerator: ((path: string) => string) | null;
  thumbnailUrlGenerator: ((path: string) => string) | null;
  failedImagePaths: Set<string>;
}>();

defineEmits<{
  (e: 'click', item: MediaFile): void;
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
</script>

<style scoped>
.grid-item {
  /* Enable GPU acceleration */
  will-change: border-color;
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
