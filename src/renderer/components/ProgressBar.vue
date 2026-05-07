<template>
  <div
    class="progress-container group relative w-full h-10 md:h-12 flex items-center cursor-pointer touch-none select-none outline-none"
    data-testid="video-progress-bar"
    role="slider"
    tabindex="0"
    aria-label="Seek video"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-valuenow="progressPercentage"
    :aria-valuetext="`${formatTime(displayTime)} of ${formatTime(duration)}`"
    @mousedown="handleMouseDown"
    @touchstart="handleTouchStart"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
    @keydown="handleKeyDown"
  >
    <!-- Heatmap Canvas (Background & Waveform) -->
    <canvas
      ref="heatmapCanvas"
      class="absolute top-0 left-0 w-full h-full opacity-100 pointer-events-none"
    ></canvas>

    <!-- Scrubber Handle (Visible on Hover/Drag) -->
    <div
      class="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md transform scale-0 transition-transform duration-200 ease-out z-20"
      :class="{ 'scale-100': isHovering || isDragging || isFocused }"
      :style="{
        left: `${progressPercentage}%`,
        marginLeft: `-${(progressPercentage / 100) * 16}px`,
      }"
    ></div>

    <!-- Hover Time Tooltip (Optional, improved positioning) -->
    <div
      v-if="isHovering || isDragging"
      class="absolute -top-8 bg-black/80 text-white text-xs px-2 py-1 rounded backdrop-blur-md pointer-events-none transform -translate-x-1/2"
      :style="{ left: `${progressPercentage}%` }"
    >
      {{ formatTime(displayTime) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { HeatmapData } from '../../core/types';
import { useUIStore } from '../composables/useUIStore';

const props = defineProps<{
  currentTime: number;
  duration: number;
  buffered?: number; // Buffered end time in seconds
  heatmap?: HeatmapData | null;
  watchedSegments?: { start: number; end: number }[];
}>();

const emit = defineEmits<{
  (e: 'seek', time: number): void;
  (e: 'scrub-start'): void;
  (e: 'scrub-end'): void;
}>();

const uiStore = useUIStore();
const isDragging = ref(false);
const isHovering = ref(false);
const isFocused = ref(false);
const localPreviewTime = ref(0);
const heatmapCanvas = ref<HTMLCanvasElement | null>(null);

// Cache theme colors to avoid getComputedStyle in the draw loop
const themeColors = ref({
  accent: '#6366f1',
  accentSecondary: '#818cf8',
});

const updateThemeColors = () => {
  const style = getComputedStyle(document.documentElement);
  themeColors.value = {
    accent: style.getPropertyValue('--accent-color').trim() || '#6366f1',
    accentSecondary:
      style.getPropertyValue('--accent-secondary').trim() || '#818cf8',
  };
};

// Update colors when theme changes
if (uiStore.themeMode) {
  watch(() => uiStore.themeMode, updateThemeColors);
}

const HEATMAP_MOTION_SCALE = 0.8; // Adjust based on data range

// Format time helper
const formatTime = (seconds: number) => {
  if (!isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// Draw heatmap when data or canvas changes
const drawHeatmap = () => {
  const canvas = heatmapCanvas.value;

  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  // Match resolution
  canvas.width = rect.width;
  canvas.height = rect.height;

  const width = canvas.width;
  const height = canvas.height;
  const centerY = height / 2;

  ctx.clearRect(0, 0, width, height);

  const data = props.heatmap;

  // Helper to draw the waveform bars
  const drawWaveform = (color: string | CanvasGradient) => {
    if (!data || !data.points || (!data.motion && !data.audio)) {
      // Fallback: Draw simple straight line if no data
      ctx.fillStyle = color;
      ctx.fillRect(0, centerY - 2, width, 4);
      return;
    }

    ctx.fillStyle = color;
    const barWidth = width / data.points;
    const gap = 0.5; // Slight gap between bars

    // Iterate points
    const points = data.points;
    for (let i = 0; i < points; i++) {
      // Calculate Bar Height
      // Use motion primarily, or fall back to audio, or a mix
      // Standardize value to 0-1 range
      let value = 0.1; // Min height

      if (data.motion && data.motion[i] !== undefined) {
        value = Math.max(value, (data.motion[i] * HEATMAP_MOTION_SCALE) / 10);
        // Dividing by 10 as rough normalization if YDIF is around 0-20ish
      } else if (data.audio && data.audio[i] !== undefined) {
        // Audio is often -90 to 0. Normalize.
        const audioNorm = Math.max(0, (data.audio[i] + 60) / 60);
        value = Math.max(value, audioNorm);
      }

      // Clamp height
      value = Math.min(1, value);

      const barHeight = value * (height * 0.8); // Leave some padding

      // Draw centered bar
      const rHeight = Math.max(2, barHeight); // Min height 2px
      const x = i * barWidth;

      // Optimization: Batch fillRects if necessary, but simple loop is fine for <500 points
      ctx.fillRect(x, centerY - rHeight / 2, barWidth - gap, rHeight);
    }
  };

  // --- Layer 1: Background (Unplayed) ---
  ctx.save();
  drawWaveform('rgba(255, 255, 255, 0.2)');
  ctx.restore();

  // --- Layer 2: Buffered ---
  if (props.buffered && props.duration) {
    const bufferedW = (props.buffered / props.duration) * width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, bufferedW, height);
    ctx.clip();
    drawWaveform('rgba(255, 255, 255, 0.4)');
    ctx.restore();
  }

  // --- Layer 3: Played (Accent Color) ---
  const currentT = isDragging.value
    ? localPreviewTime.value
    : props.currentTime;
  if (props.duration) {
    const playedW = (currentT / props.duration) * width;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, playedW, height);
    ctx.clip();

    // Use cached theme colors
    const { accent, accentSecondary } = themeColors.value;

    // Use gradient for played part
    const gradient = ctx.createLinearGradient(0, 0, playedW, 0);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(1, accentSecondary);

    drawWaveform(gradient);
    ctx.restore();
  }

  // --- Layer 4: Watched Segments (Underlay or Overlay?) ---
  // Maybe draw small indicator lines at the bottom for watched segments?
  if (props.watchedSegments && props.duration > 0) {
    ctx.fillStyle = '#22d3ee'; // Cyan
    props.watchedSegments.forEach((seg) => {
      const startX = (seg.start / props.duration) * width;
      const endX = (seg.end / props.duration) * width;
      const w = endX - startX;
      // Draw thin line at bottom
      ctx.fillRect(startX, height - 2, w, 2);
    });
  }
};

// Re-draw on resize or data change
watch(
  [
    () => props.heatmap,
    () => props.watchedSegments,
    () => props.duration,
    () => props.currentTime,
    () => props.buffered,
    () => isDragging.value,
    () => localPreviewTime.value,
  ],
  () => requestAnimationFrame(drawHeatmap),
  { immediate: true, deep: true },
);

onMounted(() => {
  updateThemeColors(); // Initial fetch
  if (heatmapCanvas.value) {
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(drawHeatmap);
    });
    ro.observe(heatmapCanvas.value);
  }
});

const displayTime = computed(() => {
  return isDragging.value ? localPreviewTime.value : props.currentTime;
});

const progressPercentage = computed(() => {
  if (!props.duration) return 0;
  return Math.min(100, Math.max(0, (displayTime.value / props.duration) * 100));
});

const calculateTimeFromEvent = (event: MouseEvent | TouchEvent) => {
  const container = (event.target as HTMLElement).closest(
    '.progress-container',
  );
  if (!container) return 0;

  const rect = container.getBoundingClientRect();
  const clientX =
    'touches' in event
      ? event.touches[0].clientX
      : (event as MouseEvent).clientX;

  const offsetX = Math.min(Math.max(0, clientX - rect.left), rect.width);
  const percentage = offsetX / rect.width;

  return percentage * props.duration;
};

const handleInteractionStart = (event: MouseEvent | TouchEvent) => {
  isDragging.value = true;
  localPreviewTime.value = calculateTimeFromEvent(event);
  emit('scrub-start');
  updateTime(event);

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('touchmove', handleTouchMove, { passive: false });
  window.addEventListener('touchend', handleTouchEnd);
};

const handleMouseDown = (event: MouseEvent) => handleInteractionStart(event);

const handleTouchStart = (event: TouchEvent) => {
  handleInteractionStart(event);
};

const handleMouseMove = (event: MouseEvent) => updateTime(event);
const handleTouchMove = (event: TouchEvent) => {
  event.preventDefault(); // Stop scrolling
  updateTime(event);
};

const updateTime = (event: MouseEvent | TouchEvent) => {
  if (!isDragging.value) return;
  localPreviewTime.value = calculateTimeFromEvent(event);
};

const handleInteractionEnd = () => {
  if (isDragging.value) {
    emit('seek', localPreviewTime.value);
    emit('scrub-end');
    isDragging.value = false;
  }

  window.removeEventListener('mousemove', handleMouseMove);
  window.removeEventListener('mouseup', handleMouseUp);
  window.removeEventListener('touchmove', handleTouchMove);
  window.removeEventListener('touchend', handleTouchEnd);
};

const handleMouseUp = () => handleInteractionEnd();
const handleTouchEnd = () => handleInteractionEnd();

const handleKeyDown = (event: KeyboardEvent) => {
  const step = 5; // seconds
  let newTime = props.currentTime;

  const handledKeys = [
    'ArrowRight',
    'ArrowLeft',
    'Home',
    'End',
    'PageUp',
    'PageDown',
  ];

  if (handledKeys.includes(event.key)) {
    // Prevent default scrolling and stop propagation to avoid conflicts with global shortcuts
    event.preventDefault();
    event.stopPropagation();

    switch (event.key) {
      case 'ArrowRight':
        newTime = Math.min(props.duration, props.currentTime + step);
        break;
      case 'ArrowLeft':
        newTime = Math.max(0, props.currentTime - step);
        break;
      case 'Home':
        newTime = 0;
        break;
      case 'End':
        newTime = props.duration;
        break;
      case 'PageUp':
        newTime = Math.min(
          props.duration,
          props.currentTime + props.duration * 0.1,
        );
        break;
      case 'PageDown':
        newTime = Math.max(0, props.currentTime - props.duration * 0.1);
        break;
    }
    emit('seek', newTime);
  }
};
</script>

<style scoped>
/* Gradient for the active bar */
.progress-container .bg-\(--accent-color\) {
  background-color: var(--accent-color, #6366f1);
}
</style>
