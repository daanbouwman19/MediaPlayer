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
      @click="togglePlay"
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
import { ref, watch, onUnmounted, computed, onMounted } from 'vue';
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
const hlsInstance = ref<Hls | null>(null);

const isHls = computed(
  () => !!props.src?.includes('.m3u8') && Hls.isSupported(),
);

const effectiveSrc = computed(() => {
  if (isHls.value) {
    return undefined;
  }
  return props.src || undefined;
});

const destroyHls = () => {
  if (hlsInstance.value) {
    console.log('[VideoPlayer] Destroying HLS instance');
    hlsInstance.value.destroy();
    hlsInstance.value = null;
  }
};

const initHls = () => {
  destroyHls();

  if (!props.src || !videoElement.value) return;

  if (isHls.value) {
    console.log('[VideoPlayer] Initializing HLS for:', props.src);

    // Explicitly reset video element to clear any previous error state or source
    videoElement.value.pause();
    videoElement.value.removeAttribute('src');
    videoElement.value.load();

    const hls = new Hls({
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      enableWorker: true,
      startPosition:
        props.initialTime && props.initialTime > 0 ? props.initialTime : -1,
    });

    hlsInstance.value = hls;
    hls.attachMedia(videoElement.value);

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      console.log('[VideoPlayer] HLS Media attached');
      if (props.src) {
        hls.loadSource(props.src);
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      console.log('[VideoPlayer] HLS Manifest parsed');
      // Use a small delay to ensure video element is ready for play()
      setTimeout(() => {
        if (videoElement.value && videoElement.value.paused) {
          videoElement.value.play().catch((err) => {
            if (err.name !== 'AbortError') {
              console.warn('[VideoPlayer] Autoplay failed:', err);
            }
          });
        }
      }, 0);
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
      console.log(
        '[VideoPlayer] HLS Level loaded:',
        data.details.live ? 'live' : 'vod',
      );
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        console.error(
          '[VideoPlayer] HLS Fatal Error:',
          data.type,
          data.details,
        );
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            destroyHls();
            emit('error', new Error(`HLS Fatal Error: ${data.details}`));
            break;
        }
      }
    });
  } else if (
    props.src.includes('.m3u8') &&
    videoElement.value.canPlayType('application/vnd.apple.mpegurl')
  ) {
    console.log('[VideoPlayer] Falling back to native HLS');
    videoElement.value.src = props.src;
    if (props.initialTime && props.initialTime > 0) {
      videoElement.value.currentTime = props.initialTime;
    }
  }
};

onMounted(() => {
  if (videoElement.value) {
    emit('update:video-element', videoElement.value);
    if (
      props.initialTime &&
      props.initialTime > 0 &&
      !props.src?.includes('.m3u8')
    ) {
      videoElement.value.currentTime = props.initialTime;
    }
    initHls();
  }
});

onUnmounted(() => {
  destroyHls();
});

watch(
  () => props.src,
  (newSrc, oldSrc) => {
    if (newSrc === oldSrc) return;
    console.log('[VideoPlayer] Source changed:', newSrc);
    isEnded.value = false;
    initHls();
  },
);

const togglePlay = () => {
  if (!props.isControlsVisible) return;

  if (videoElement.value) {
    if (videoElement.value.paused) {
      // Don't try to play if no source yet
      if (!videoElement.value.src && !videoElement.value.srcObject) {
        console.log('[VideoPlayer] Play ignored: No source attached yet');
        return;
      }

      videoElement.value.play()?.catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('[VideoPlayer] Play failed:', err);
        }
      });
    } else {
      videoElement.value.pause();
    }
  }
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
  isPlaying.value = false;
  emit('ended');
};

const handleSeeking = () => {
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
