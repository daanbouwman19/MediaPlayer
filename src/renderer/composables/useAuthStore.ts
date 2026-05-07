import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { WebAdapter } from '../api/WebAdapter';
import { ElectronAdapter } from '../api/ElectronAdapter';
import type { IMediaBackend } from '../api/types';

// Detect environment
const isElectron = !!(window && window.electronAPI);
const backend: IMediaBackend = isElectron
  ? new ElectronAdapter()
  : new WebAdapter();

interface AuthState {
  isLocked: boolean;
  isInitialized: boolean;
  isEnabled: boolean;
}

const usePiniaAuthStore = defineStore('auth', () => {
  const state = reactive<AuthState>({
    isLocked: false,
    isInitialized: false,
    isEnabled: false,
  });

  async function checkLockStatus() {
    try {
      const status = await backend.getLockStatus();
      state.isEnabled = status.enabled;
      state.isLocked = status.enabled && !status.isAuthenticated;
      state.isInitialized = true;
    } catch (error) {
      console.error('Failed to check lock status:', error);
      // Fallback to unlocked
      state.isInitialized = true;
    }
  }

  async function unlock(password: string): Promise<boolean> {
    try {
      const success = await backend.unlock(password);
      if (success) {
        state.isLocked = false;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Unlock failed:', error);
      return false;
    }
  }

  return { state, checkLockStatus, unlock };
});

export function useAuthStore() {
  const store = usePiniaAuthStore();
  return {
    ...toRefs(store.state),
    checkLockStatus: store.checkLockStatus,
    unlock: store.unlock,
  };
}
