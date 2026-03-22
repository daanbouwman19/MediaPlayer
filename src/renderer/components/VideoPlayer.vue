<template>
  <div class="video-player-container relative w-full h-full">
    <!-- Video Element -->
    <video
      ref="videoElement"
      class="w-full h-full object-contain rounded-xl"
      :src="effectiveSrc"
      :poster="poster"
      autoplay
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
      @click="togglePlay"
    />

    <!-- Pause/Replay Overlay -->
    <div
      v-if="!isPlaying && !isTranscodingLoading && !isBuffering"
      class="absolute inset-0 flex items-center justify-center z-10 pointer-events-none"
    >
      <button
        type="button"
        class="bg-black/40 p-4 rounded-full backdrop-blur-sm pointer-events-auto hover:bg-(--accent-color)/80 transition-colors focus:outline-none focus:ring-2 focus:ring-white/50"
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
import { ref, watch, onUnmounted, computed } from 'vue';
import PlayIcon from './icons/PlayIcon.vue';
import RefreshIcon from './icons/RefreshIcon.vue';
import Hls from 'hls.js';

const props = defineProps<{
  src: string | null;
  poster?: string;
  isTranscodingMode: boolean;
  isControlsVisible: boolean;
  transcodedDuration: number;
  currentTranscodeStartTime: number;
  isTranscodingLoading: boolean;
  isBuffering: boolean;
  initialTime?: number;
}>();

const emit = defineEmits<{
  (e: 'play'): void;
  (e: 'pause'): void;
  (e: 'ended'): void;
  (e: 'error', error: Event): void;
  (e: 'trigger-transcode', time: number): void;
  (e: 'buffering', isBuffering: boolean): void;
  (e: 'playing'): void;
  (e: 'update:video-element', el: HTMLVideoElement | null): void;
  (e: 'timeupdate', time: number): void;
}>();

const videoElement = ref<HTMLVideoElement | null>(null);
const isPlaying = ref(false);
const isEnded = ref(false);

const hls = ref<Hls | null>(null);

const effectiveSrc = computed(() => {
  // If Hls.js is supported and it's an m3u8, we return undefined
  // so the video element doesn't try to load it natively (except via Hls.js attachment)
  if (props.src?.includes('.m3u8') && Hls.isSupported()) {
    return undefined;
  }
  return props.src || undefined;
});

const initHls = () => {
  if (hls.value) {
    hls.value.destroy();
    hls.value = null;
  }

  if (!props.src || !videoElement.value) return;

  if (props.src.includes('.m3u8')) {
    if (Hls.isSupported()) {
      const hlsInstance = new Hls({
        // Bolt Optimization: Increase internal buffer to reduce stalls
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hls.value = hlsInstance;

      // Explicitly clear src to prevent native browser behavior
      if (videoElement.value) {
        videoElement.value.src = '';
      }

      hlsInstance.loadSource(props.src);
      hlsInstance.attachMedia(videoElement.value!);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('[VideoPlayer] HLS Manifest parsed, attempting play');
        videoElement.value
          ?.play()
          .catch((err) =>
            console.warn('[VideoPlayer] Autoplay blocked or failed:', err),
          );
      });

      hlsInstance.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        console.log('[VideoPlayer] HLS Level loaded:', data.details.live ? 'live' : 'vod');
      });

      hlsInstance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.error('HLS Fatal Error:', data);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
            default:
              hlsInstance.destroy();
              break;
          }
        }
      });
    } else if (
      videoElement.value.canPlayType('application/vnd.apple.mpegurl')
    ) {
      videoElement.value.src = props.src;
    }
  }
};

onUnmounted(() => {
  if (hls.value) {
    hls.value.destroy();
  }
});

watch(videoElement, (el) => {
  emit('update:video-element', el);
  if (el && props.initialTime && props.initialTime > 0) {
    el.currentTime = props.initialTime;
  }
  initHls();
});

// Watch src to reset state if needed
watch(
  () => props.src,
  () => {
    initHls();
  },
  { immediate: true },
);

const togglePlay = () => {
  // If controls are hidden, the first click should only show them.
  // The play/pause action is prevented, and the click event is allowed to bubble up
  // to the parent component (App.vue), which handles showing the controls.
  if (!props.isControlsVisible) {
    return;
  }

  if (videoElement.value) {
    if (videoElement.value.paused) {
      videoElement.value.play?.()?.catch((error) => {
        console.error('Error attempting to play video:', error);
      });
    } else {
      videoElement.value.pause?.();
    }
  }
};

const reset = () => {
  if (videoElement.value) {
    videoElement.value.pause();
    videoElement.value.removeAttribute('src');
    videoElement.value.load();
  }
};

const handlePlay = () => {
  isPlaying.value = true;
  isEnded.value = false;
  emit('play');
};

const handlePause = () => {
  isPlaying.value = false;
  emit('pause');
};

const handleEnded = () => {
  isEnded.value = true;
  emit('ended');
};

const handleSeeking = () => {
  // If user scrubs, they likely want to resume play or see a specific frame,
  // so we clear the 'ended' state to show the normal play button if paused.
  isEnded.value = false;
};

const handleError = (e: Event) => {
  emit('error', e);
};

const handlePlaying = () => {
  emit('playing');
};

const handleWaiting = () => {
  emit('buffering', true);
};

const handleCanPlay = () => {
  emit('buffering', false);
};

const handleLoadedMetadata = (event: Event) => {
  const video = event.target as HTMLVideoElement;
  if (
    (video.videoWidth === 0 || video.videoHeight === 0) &&
    !props.isTranscodingMode
  ) {
    emit('trigger-transcode', 0);
  }
};

const handleTimeUpdate = (event: Event) => {
  const target = event.target as HTMLVideoElement;
  const { currentTime } = target;

  let realCurrentTime = currentTime;

  if (props.isTranscodingMode && props.transcodedDuration > 0) {
    realCurrentTime = props.currentTranscodeStartTime + currentTime;
  }

  emit('timeupdate', realCurrentTime);
};

defineExpose({
  togglePlay,
  reset,
  videoElement,
});
</script>

<style scoped>
/* No styles needed for bare player */
</style>
