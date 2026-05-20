<template>
  <div class="ambient-background-container">
    <canvas ref="canvas" class="ambient-canvas"></canvas>
    <div class="vignette-overlay"></div>
    <div class="noise-overlay"></div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file Renders a global ambient background based on the current media item.
 * It uses a canvas to draw the current image or video frame and applies
 * heavy blur and saturation filters to create an immersive atmosphere.
 */
import { ref, watch, onUnmounted, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { usePlayerStore } from '../composables/usePlayerStore';
import { usePlaylistStore } from '../composables/usePlaylistStore';
import { useLibraryStore } from '../composables/useLibraryStore';
import { api } from '../api';

const playerStore = usePlayerStore();
const playlistStore = usePlaylistStore();
const libraryStore = useLibraryStore();

const { mainVideoElement } = storeToRefs(playerStore);
const { currentItem: currentMediaItem } = storeToRefs(playlistStore);
const supportedExtensions = computed(() => libraryStore.supportedExtensions);

const canvas = ref<HTMLCanvasElement | null>(null);
const mediaUrl = ref<string | null>(null);
const isImage = ref(false);
let animationFrameId: number | null = null;

/**
 * Loads the media URL for the background.
 * Cancels any existing animation loop before starting a new one.
 */
const loadMedia = async () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  if (!currentMediaItem.value) {
    mediaUrl.value = null;
    return;
  }

  try {
    const result = await api.loadFileAsDataURL(currentMediaItem.value.path);

    if (
      (result.type === 'data-url' || result.type === 'http-url') &&
      result.url
    ) {
      mediaUrl.value = result.url;

      const ext = currentMediaItem.value.path
        .slice(currentMediaItem.value.path.lastIndexOf('.'))
        .toLowerCase();
      isImage.value = supportedExtensions.value.images.includes(ext);

      if (isImage.value) {
        drawImageToCanvas();
      } else {
        startVideoLoop();
      }
    }
  } catch (err) {
    console.error('Failed to load background media:', err);
  }
};

const drawImageToCanvas = () => {
  if (!canvas.value || !mediaUrl.value) return;
  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;

  const img = new Image();
  img.src = mediaUrl.value;
  img.onload = () => {
    if (!canvas.value) return;
    canvas.value.width = window.innerWidth / 10; // Low res for performance & blur
    canvas.value.height = window.innerHeight / 10;
    ctx.drawImage(img, 0, 0, canvas.value.width, canvas.value.height);
  };
};

const startVideoLoop = () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  const loop = () => {
    // Draw video frame to blurred background canvas
    if (
      mainVideoElement.value &&
      !mainVideoElement.value.paused &&
      !mainVideoElement.value.ended &&
      canvas.value
    ) {
      const ctx = canvas.value.getContext('2d');
      if (ctx) {
        if (canvas.value.width !== window.innerWidth / 10) {
          canvas.value.width = window.innerWidth / 10;
          canvas.value.height = window.innerHeight / 10;
        }
        try {
          ctx.drawImage(
            mainVideoElement.value,
            0,
            0,
            canvas.value.width,
            canvas.value.height,
          );
        } catch {
          // Ignore cross-origin / not-ready frames
        }
      }
    }

    animationFrameId = requestAnimationFrame(loop);
  };
  loop();
};

watch(
  currentMediaItem,
  () => {
    loadMedia();
  },
  { immediate: true },
);

onMounted(() => {
  // Empty
});

onUnmounted(() => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
});
</script>

<style scoped>
.ambient-background-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0; /* Behind content (z-10) but visible */
  overflow: hidden;
  background-color: var(--primary-bg);
}

.ambient-canvas {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: blur(100px) saturate(3) brightness(0.7);
  transform: scale(1.5);
  transition: opacity 1s ease;
  animation: aurora-shift 20s infinite alternate linear;
}

@keyframes aurora-shift {
  0% {
    filter: blur(100px) saturate(3) brightness(0.7) hue-rotate(0deg);
  }
  100% {
    filter: blur(100px) saturate(3) brightness(0.7) hue-rotate(30deg);
  }
}

.vignette-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle,
    rgba(var(--vignette-color), 0) 20%,
    rgba(var(--vignette-color), var(--vignette-mid)) 70%,
    rgba(var(--vignette-color), var(--vignette-edge)) 100%
  );
  pointer-events: none;
  z-index: 2;
}

.noise-overlay {
  position: absolute;
  inset: 0;
  opacity: 0.03;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
  z-index: 3;
}
</style>
