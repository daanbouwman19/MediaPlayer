<template>
  <div class="ambient-background-container">
    <canvas ref="canvas" class="ambient-canvas"></canvas>
    <!-- Visualizer Canvas overlay -->
    <canvas ref="visualizerCanvas" class="visualizer-canvas"></canvas>
    <div class="vignette-overlay"></div>
    <div class="noise-overlay"></div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file Renders a global ambient background based on the current media item.
 * It uses a canvas to draw the current image or video frame and applies
 * heavy blur and saturation filters to create an immersive atmosphere.
 * It also features a real-time glowing frequency visualizer overlay.
 */
import { ref, watch, onUnmounted, computed, onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { usePlayerStore } from '../composables/usePlayerStore';
import { usePlaylistStore } from '../composables/usePlaylistStore';
import { useLibraryStore } from '../composables/useLibraryStore';
import { audioVisualizer } from '../utils/audioVisualizer';
import { api } from '../api';

const playerStore = usePlayerStore();
const playlistStore = usePlaylistStore();
const libraryStore = useLibraryStore();

const { mainVideoElement } = storeToRefs(playerStore);
const { currentItem: currentMediaItem } = storeToRefs(playlistStore);
const supportedExtensions = computed(() => libraryStore.supportedExtensions);

const canvas = ref<HTMLCanvasElement | null>(null);
const visualizerCanvas = ref<HTMLCanvasElement | null>(null);
const mediaUrl = ref<string | null>(null);
const isImage = ref(false);
let animationFrameId: number | null = null;
// Track if we already have a running loop so we never start two
let loopRunning = false;

const getThemeAccentColor = () => {
  const styles = getComputedStyle(document.documentElement);
  return styles.getPropertyValue('--accent-color').trim() || '#7c3aed';
};

const getThemeAccentSecondary = () => {
  const styles = getComputedStyle(document.documentElement);
  return styles.getPropertyValue('--accent-secondary').trim() || '#0ea5e9';
};

/**
 * Loads the media URL for the background.
 * Cancels any existing animation loop before starting a new one.
 */
const loadMedia = async () => {
  // Cancel any in-flight loop from the previous media item
  loopRunning = false;
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
        // Still run the visualizer loop so waveforms show on image media
        startVisualizerLoop();
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

const resizeVisualizer = () => {
  if (visualizerCanvas.value) {
    visualizerCanvas.value.width = window.innerWidth;
    visualizerCanvas.value.height = window.innerHeight;
  }
};

const drawVisualizer = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dataArray: Uint8Array,
) => {
  ctx.clearRect(0, 0, width, height);

  const length = dataArray.length;
  if (length === 0) return;

  const accent = getThemeAccentColor();
  const accentSecondary = getThemeAccentSecondary();

  // 1. Calculate average volume (RMS) to apply dynamic auto-gain
  let sum = 0;
  for (let i = 0; i < length; i++) {
    sum += dataArray[i];
  }
  const avg = sum / length;
  // Apply a dynamic multiplier so quiet audio still produces a beautiful wave
  const boost = avg > 5 ? Math.max(1.2, Math.min(3.5, 80 / avg)) : 1.5;

  // 2. Symmetric Wave Configuration
  // We mirror the wave from the center to make it look balanced and premium.
  const activeBins = Math.floor(length * 0.75); // focus on low/mid frequencies
  const points: { x: number; y: number }[] = [];
  const centerX = width / 2;

  // Generate points from center outwards
  for (let i = 0; i < activeBins; i++) {
    const v = (dataArray[i] / 255.0) * boost;
    // Map frequency intensity to a height up to 45% of the screen
    const waveHeight = Math.min(height * 0.45, (v * height) / 3.2);
    
    // We add a tiny base height so it ripples gracefully even during silences
    const finalY = height - waveHeight - 30;
    points.push({ x: i, y: finalY });
  }

  const numPoints = points.length;
  if (numPoints < 2) return;

  // Draw Primary Wave & Soft Gradient Fill
  ctx.save();
  
  // Primary Stroke style
  const gradLine = ctx.createLinearGradient(0, 0, width, 0);
  gradLine.addColorStop(0, accent);
  gradLine.addColorStop(0.5, accentSecondary);
  gradLine.addColorStop(1, accent);

  ctx.shadowBlur = 20;
  ctx.shadowColor = accent;
  ctx.lineWidth = 4;
  ctx.strokeStyle = gradLine;
  ctx.beginPath();

  // Begin path for the fill
  const fillPath = new Path2D();
  fillPath.moveTo(0, height);

  // Draw symmetric curve (Left half)
  let prevX = 0;
  let prevY = points[0].y;
  ctx.moveTo(0, prevY);
  fillPath.lineTo(0, prevY);

  for (let i = 1; i < numPoints; i++) {
    const ratio = i / (numPoints - 1);
    const x = centerX - ratio * centerX;
    const y = points[i].y;
    const xc = (x + prevX) / 2;
    const yc = (y + prevY) / 2;
    
    ctx.quadraticCurveTo(prevX, prevY, xc, yc);
    fillPath.quadraticCurveTo(prevX, prevY, xc, yc);
    
    prevX = x;
    prevY = y;
  }
  ctx.lineTo(centerX, prevY);
  fillPath.lineTo(centerX, prevY);

  // Draw symmetric curve (Right half)
  prevX = width;
  prevY = points[0].y;
  ctx.moveTo(width, prevY);
  fillPath.lineTo(width, prevY);

  for (let i = 1; i < numPoints; i++) {
    const ratio = i / (numPoints - 1);
    const x = centerX + ratio * centerX;
    const y = points[i].y;
    const xc = (x + prevX) / 2;
    const yc = (y + prevY) / 2;
    
    ctx.quadraticCurveTo(prevX, prevY, xc, yc);
    fillPath.quadraticCurveTo(prevX, prevY, xc, yc);
    
    prevX = x;
    prevY = y;
  }
  ctx.lineTo(centerX, prevY);
  fillPath.lineTo(centerX, prevY);

  ctx.stroke();

  // Close the fill path and draw the ambient glowing background under the wave
  fillPath.lineTo(centerX, height);
  fillPath.lineTo(0, height);
  
  const gradFill = ctx.createLinearGradient(0, height - 200, 0, height);
  gradFill.addColorStop(0, accent + '33'); // 20% opacity at peak
  gradFill.addColorStop(0.5, accentSecondary + '1a'); // 10% opacity mid
  gradFill.addColorStop(1, 'transparent');
  
  ctx.shadowBlur = 0; // Disable shadow for fill to optimize performance
  ctx.fillStyle = gradFill;
  ctx.fill(fillPath);

  // 3. Secondary subtle overlay wave for gorgeous depth
  ctx.restore();
  ctx.beginPath();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accentSecondary + '80'; // 50% opacity line
  
  prevX = 0;
  prevY = height - 40;
  ctx.moveTo(0, prevY);

  for (let i = 1; i < numPoints; i++) {
    const ratio = i / (numPoints - 1);
    // Offset phase for secondary wave
    const waveIndex = Math.floor(length - 1 - i * 0.5) % length;
    const v = (dataArray[waveIndex] / 255.0) * boost * 0.5;
    const y = height - (v * height) / 5 - 45;
    
    const xLeft = centerX - ratio * centerX;
    const xcLeft = (xLeft + prevX) / 2;
    const ycLeft = (y + prevY) / 2;
    
    ctx.quadraticCurveTo(prevX, prevY, xcLeft, ycLeft);
    prevX = xLeft;
    prevY = y;
  }
  ctx.stroke();
};

const startVisualizerLoop = () => {
  if (loopRunning) return;
  loopRunning = true;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  const loop = () => {
    const dataArray = audioVisualizer.getFrequencyData();
    if (visualizerCanvas.value) {
      const ctx = visualizerCanvas.value.getContext('2d');
      if (ctx) {
        drawVisualizer(
          ctx,
          visualizerCanvas.value.width,
          visualizerCanvas.value.height,
          dataArray,
        );
      }
    }
    animationFrameId = requestAnimationFrame(loop);
  };
  loop();
};

const startVideoLoop = () => {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  loopRunning = true;

  const loop = () => {
    // 1. Draw video frame to blurred background canvas
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

    // 2. Draw visualizer – uses pre-allocated buffer, no per-frame allocation
    const dataArray = audioVisualizer.getFrequencyData();
    if (visualizerCanvas.value) {
      const ctx = visualizerCanvas.value.getContext('2d');
      if (ctx) {
        drawVisualizer(
          ctx,
          visualizerCanvas.value.width,
          visualizerCanvas.value.height,
          dataArray,
        );
      }
    }

    animationFrameId = requestAnimationFrame(loop);
  };
  loop();
};

const handleResize = () => {
  resizeVisualizer();
};

watch(
  currentMediaItem,
  () => {
    loadMedia();
  },
  { immediate: true },
);

onMounted(() => {
  resizeVisualizer();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  loopRunning = false;
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  window.removeEventListener('resize', handleResize);
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

.visualizer-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.8;
  z-index: 1;
  will-change: transform;
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
