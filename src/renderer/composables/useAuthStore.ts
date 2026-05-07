import { defineStore } from 'pinia';
import { ref } from 'vue';
import { WebAdapter } from '../api/WebAdapter';
import { ElectronAdapter } from '../api/ElectronAdapter';
import type { IMediaBackend } from '../api/types';

// Detect environment
const isElectron = !!(window && window.electronAPI);
const backend: IMediaBackend = isElectron
  ? new ElectronAdapter()
  : new WebAdapter();

export const useAuthStore = defineStore('auth', () => {
  const isLocked = ref(false);
  const isInitialized = ref(false);
  const isEnabled = ref(false);

  async function checkLockStatus() {
    try {
      const status = await backend.getLockStatus();
      isEnabled.value = status.enabled;
      isLocked.value = status.enabled && !status.isAuthenticated;
      isInitialized.value = true;
    } catch (error) {
      console.error('Failed to check lock status:', error);
      // Fallback to unlocked
      isInitialized.value = true;
    }
  }

  async function unlock(password: string): Promise<boolean> {
    try {
      const success = await backend.unlock(password);
      if (success) {
        isLocked.value = false;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Unlock failed:', error);
      return false;
    }
  }

  return {
    isLocked,
    isInitialized,
    isEnabled,
    checkLockStatus,
    unlock,
  };
});
