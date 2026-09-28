<template>
  <div
    class="video-player-container relative w-full h-full bg-black flex items-center justify-center overflow-hidden rounded-xl"
  >
    <!-- Video Element -->
    <video
      ref="videoElement"
      class="w-full h-full object-contain"
      :src="effectiveSrc"
      :poster="poster"
      :autoplay="!isHls"
      crossorigin="anonymous"
      @error="handleError"
      @ended="handleEnded"
      @play="handlePlay"
      @playing="handlePlaying"
      @pause="handlePause"
      @timeupdate="handleTimeUpdate"
      @loadedmetadata="handleLoadedMetadata"
      @waiting="handleWaiting"
      @canplay="handleCanPlay"
      @seeking="handleSeeking"
      @click="handleVideoClick"
    />

    <!-- Pause/Replay Overlay -->
    <div
      v-if="!isPlaying && !isTranscodingLoading && !isBuffering"
      class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
    >
      <button
        type="button"
        class="bg-black/40 p-4 rounded-full backdrop-blur-sm pointer-events-auto hover:bg-(--accent-color)/80 transition-all duration-200 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-white/50"
        :aria-label="isEnded ? 'Replay video' : 'Play video'"
        @click="togglePlay"
      >
        <RefreshIcon v-if="isEnded" class="w-12 h-12 text-white" />
        <PlayIcon v-else class="w-12 h-12 text-white" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onBeforeUnmount, computed, onMounted } from 'vue';
import PlayIcon from '@/components/atoms/icons/PlayIcon.vue';
import RefreshIcon from '@/components/atoms/icons/RefreshIcon.vue';
import {
  attachHlsSource,
  isHlsSource,
  needsHlsJs,
  type HlsSource,
} from '@/utils/hlsPlayback';

const props = defineProps<{
  src: string | null;
  poster?: string | undefined;
  isTranscodingMode: boolean;
  isControlsVisible: boolean;
  isTranscodingLoading: boolean;
  isBuffering: boolean;
  initialTime?: number;
}>();

const emit = defineEmits<{
  (e: 'play'): void;
  (e: 'pause'): void;
  (e: 'ended'): void;
  (e: 'error', error: Event | Error): void;
  (e: 'trigger-transcode', time: number): void;
  (e: 'buffering', isBuffering: boolean): void;
  (e: 'playing'): void;
  (e: 'update:video-element', el: HTMLVideoElement | null): void;
  (e: 'timeupdate', time: number): void;
  (e: 'loadedmetadata', event: Event): void;
}>();

const videoElement = ref<HTMLVideoElement | null>(null);
const isPlaying = ref(false);
const isEnded = ref(false);
let hlsSource: HlsSource | null = null;
// Set once unmounting starts. Releasing the element queues media events
// (pause, timeupdate at 0...) that must not reach the parent, which by then
// already tracks the next player.
let isDisposed = false;

const isHls = computed(() => needsHlsJs(props.src));

const effectiveSrc = computed(() => {
  if (isHls.value) {
    return undefined;
  }
  return props.src || undefined;
});

const isAbortError = (err: unknown) =>
  err instanceof Error && err.name === 'AbortError';

const destroyHls = () => {
  if (hlsSource) {
    console.log('[VideoPlayer] Destroying HLS instance');
    hlsSource.destroy();
    hlsSource = null;
  }
};

const autoplayHls = () => {
  // Use a small delay to ensure video element is ready for play()
  setTimeout(() => {
    const video = videoElement.value;
    if (video && video.paused && !isDisposed) {
      video.play().catch((err: unknown) => {
        if (!isAbortError(err)) {
          console.warn('[VideoPlayer] Autoplay failed:', err);
        }
      });
    }
  }, 0);
};

const initHls = () => {
  destroyHls();

  const video = videoElement.value;
  const src = props.src;
  if (!src || !video) return;

  if (needsHlsJs(src)) {
    console.log('[VideoPlayer] Initializing HLS for:', src);

    // Explicitly reset video element to clear any previous error state or source
    video.pause();
    video.removeAttribute('src');
    video.load();

    hlsSource = attachHlsSource(video, src, {
      startPosition: props.initialTime,
      onManifestParsed: autoplayHls,
      onFatalError: (error) => {
        hlsSource = null;
        if (!isDisposed) emit('error', error);
      },
    });
  } else if (
    isHlsSource(src) &&
    video.canPlayType('application/vnd.apple.mpegurl')
  ) {
    console.log('[VideoPlayer] Falling back to native HLS');
    video.src = src;
    if (props.initialTime && props.initialTime > 0) {
      video.currentTime = props.initialTime;
    }
  }
};

onMounted(() => {
  if (videoElement.value) {
    emit('update:video-element', videoElement.value);
    if (props.initialTime && props.initialTime > 0 && !isHlsSource(props.src)) {
      videoElement.value.currentTime = props.initialTime;
    }
    initHls();
  }
});

onBeforeUnmount(() => {
  destroyHls();
  emit('update:video-element', null);
  isDisposed = true;
  const video = videoElement.value;
  if (video) {
    // Release the decoder and the network connection now rather than
    // whenever the detached element is garbage collected.
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
});

// flush: 'post' runs initHls after the DOM patch. With the default 'pre'
// flush, hls.js would attach its MediaSource (blob: src) first and Vue would
// then patch :src to undefined, detaching it: a direct-play -> HLS fallback
// on the same instance would never load.
watch(
  () => props.src,
  (newSrc, oldSrc) => {
    if (newSrc === oldSrc) return;
    console.log('[VideoPlayer] Source changed:', newSrc);
    isEnded.value = false;
    initHls();
  },
  { flush: 'post' },
);

/** Toggles playback unconditionally (keyboard, control bar, play overlay). */
const togglePlay = () => {
  const video = videoElement.value;
  if (!video) return;

  if (video.paused) {
    // Don't try to play if no source yet
    if (!video.src && !video.srcObject) {
      console.log('[VideoPlayer] Play ignored: No source attached yet');
      return;
    }

    video.play()?.catch((err: unknown) => {
      if (!isAbortError(err)) {
        console.error('[VideoPlayer] Play failed:', err);
      }
    });
  } else {
    video.pause();
  }
};

/**
 * A click/tap on the video only toggles playback while the controls are
 * shown; with hidden controls the first tap just reveals them (App.vue).
 */
const handleVideoClick = () => {
  if (!props.isControlsVisible) return;
  togglePlay();
};

const reset = () => {
  destroyHls();
  if (videoElement.value) {
    videoElement.value.pause();
    videoElement.value.removeAttribute('src');
    videoElement.value.load();
  }
};

const handlePlay = () => {
  if (isDisposed) return;
  isPlaying.value = true;
  isEnded.value = false;
  emit('play');
};

const handlePause = () => {
  if (isDisposed) return;
  isPlaying.value = false;
  emit('pause');
};

const handleEnded = () => {
  if (isDisposed) return;
  isEnded.value = true;
  isPlaying.value = false;
  emit('ended');
};

const handleSeeking = () => {
  isEnded.value = false;
};

const handleError = (e: Event) => {
  if (isDisposed) return;
  emit('error', e);
};

const handlePlaying = () => {
  if (isDisposed) return;
  emit('playing');
};

const handleWaiting = () => {
  if (isDisposed) return;
  emit('buffering', true);
};

const handleCanPlay = () => {
  if (isDisposed) return;
  emit('buffering', false);
};

const handleLoadedMetadata = (event: Event) => {
  if (isDisposed) return;
  const video = event.target as HTMLVideoElement;
  emit('loadedmetadata', event);
  if (
    (video.videoWidth === 0 || video.videoHeight === 0) &&
    !props.isTranscodingMode
  ) {
    console.log(
      '[VideoPlayer] Metadata loaded but dimensions missing, triggering transcode',
    );
    emit('trigger-transcode', 0);
  }
};

// The HLS stream is one absolute timeline from 0 (one transcode session per
// file), so the element's currentTime already is the real position.
const handleTimeUpdate = (event: Event) => {
  if (isDisposed) return;
  const target = event.target as HTMLVideoElement;
  emit('timeupdate', target.currentTime);
};

defineExpose({
  togglePlay,
  reset,
  videoElement,
});
</script>
