<template>
  <div
    class="fixed inset-0 bg-black/90 flex items-center justify-center z-[3000] backdrop-blur-xl"
    role="dialog"
    aria-modal="true"
  >
    <div
      class="max-w-md w-full p-8 text-center bg-white/10 rounded-2xl border border-white/20 shadow-2xl mx-4"
    >
      <div class="mb-6">
        <div
          class="w-20 h-20 bg-accent rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg shadow-accent/30"
        >
          <LockIcon class="w-10 h-10 text-button-text" />
        </div>
        <h2 class="text-3xl font-bold text-white mb-2">Media Locked</h2>
        <p class="text-white/60">Enter the password to access your library</p>
      </div>

      <form class="space-y-4" @submit.prevent="handleUnlock">
        <div class="relative">
          <label for="password-input" class="sr-only">Password</label>
          <input
            id="password-input"
            v-model="password"
            type="password"
            placeholder="Password"
            class="w-full bg-white/5 border border-white/10 rounded-xl px-5 py-4 text-white focus:outline-none focus:ring-2 focus:ring-accent focus:bg-white/10 transition-all text-lg placeholder:text-white/20"
            :disabled="isUnlocking"
            autofocus
          />
        </div>

        <p v-if="error" class="text-red-400 text-sm font-medium animate-pulse">
          {{ error }}
        </p>

        <button
          type="submit"
          class="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed text-button-text font-bold py-4 rounded-xl transition-all shadow-lg shadow-accent/20 text-lg flex items-center justify-center gap-2"
          :disabled="isUnlocking || !password"
        >
          <span v-if="isUnlocking" class="spinner-small"></span>
          <span>{{ isUnlocking ? 'Unlocking...' : 'Unlock Library' }}</span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import LockIcon from './icons/LockIcon.vue';
import { useAuthStore } from '../composables/useAuthStore';
import { useLibraryStore } from '../composables/useLibraryStore';

const authStore = useAuthStore();
const libraryStore = useLibraryStore();
const { unlock } = authStore;

const password = ref('');
const isUnlocking = ref(false);
const error = ref('');

const handleUnlock = async () => {
  if (!password.value) return;

  error.value = '';
  isUnlocking.value = true;

  try {
    const success = await unlock(password.value);
    if (success) {
      // Reload initial data after successful unlock
      await libraryStore.loadInitialData();
    } else {
      error.value = 'Invalid password. Please try again.';
      password.value = '';
    }
  } catch {
    error.value = 'An error occurred. Please try again.';
  } finally {
    isUnlocking.value = false;
  }
};
</script>

<style scoped>
.spinner-small {
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: #fff;
  width: 20px;
  height: 20px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
