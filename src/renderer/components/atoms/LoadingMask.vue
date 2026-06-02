<template>
  <div
    class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center"
    style="z-index: 2000"
    role="status"
    aria-live="assertive"
    aria-atomic="true"
  >
    <div class="text-center text-white" role="document">
      <div class="spinner mb-4" aria-hidden="true"></div>
      <p class="text-xl">{{ message }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file This component displays a loading overlay with a spinner.
 * It is used to indicate that a background process, such as media scanning, is in progress.
 */
withDefaults(
  defineProps<{
    message?: string;
  }>(),
  {
    message: 'Scanning for media...',
  },
);
</script>

<style scoped>
.spinner {
  border: 4px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff;
  width: 50px;
  height: 50px;
  animation: spin 1s linear infinite;
  margin: 0 auto;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
