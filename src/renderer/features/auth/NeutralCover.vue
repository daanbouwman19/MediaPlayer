<template>
  <div
    ref="coverRef"
    class="neutral-cover fixed inset-0 z-3000 flex items-end justify-center pb-8"
    role="dialog"
    aria-modal="true"
    aria-label="Screen hidden"
    tabindex="-1"
    @pointerdown="authStore.uncover()"
    @keydown="handleKeydown"
  >
    <p class="text-sm text-white/20 select-none">
      Press any key or click to continue
    </p>
  </div>
</template>

<script setup lang="ts">
/**
 * @file Plain screen that hides the library when the panic key or auto-lock
 * fires and no password or PIN is set. Any key or click dismisses it.
 */
import { ref } from 'vue';
import { useAuthStore } from '@/composables/useAuthStore';
import { useFocusTrap } from '@/composables/useFocusTrap';

const authStore = useAuthStore();
const coverRef = ref<HTMLElement | null>(null);
useFocusTrap(coverRef, true, { initialFocus: coverRef });

const handleKeydown = (event: KeyboardEvent) => {
  // Bare modifiers are often part of reaching for another key.
  if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
  // The key only dismisses the cover; it must not also reach app shortcuts.
  event.preventDefault();
  event.stopPropagation();
  authStore.uncover();
};
</script>

<style scoped>
.neutral-cover {
  background-color: #111;
}

.neutral-cover:focus-visible {
  outline: none;
}
</style>
