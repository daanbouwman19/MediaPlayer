<template>
  <div
    v-if="isLoading || isTranscodingLoading || isBuffering"
    class="absolute inset-0 flex flex-col items-center justify-center bg-black/60 z-20 pointer-events-none"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <div
      class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-accent mb-4"
      aria-hidden="true"
    ></div>
    <p class="text-white font-semibold text-center">
      <template v-if="isTranscodingLoading">
        <div>Transcoding...</div>
        <div v-if="progress !== null" class="text-sm font-normal opacity-80">
          {{ Math.round(progress) }}%
        </div>
        <div
          v-else-if="transcodedDuration > 0"
          class="text-sm font-normal opacity-80"
        >
          {{
            Math.round((currentTranscodeStartTime / transcodedDuration) * 100)
          }}%
        </div>
      </template>
      <template v-else-if="isBuffering">Buffering...</template>
      <template v-else>Loading media...</template>
    </p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  isLoading: boolean;
  isTranscodingLoading: boolean;
  isBuffering: boolean;
  transcodedDuration: number;
  currentTranscodeStartTime: number;
  progress: number | null;
}>();
</script>
