import { defineStore } from 'pinia';
import { ref } from 'vue';
import { WebAdapter } from '../api/WebAdapter';
import { ElectronAdapter } from '../api/ElectronAdapter';
import { HttpError } from '../api/http-error';
import type { IMediaBackend } from '../api/types';

/**
 * Outcome of an unlock attempt:
 * - `ok`: the library is unlocked.
 * - `invalid`: the password was rejected.
 * - `rateLimited`: too many attempts; the server refused to check it (429).
 * - `error`: the attempt could not be completed (network or server error).
 */
export type UnlockResult = 'ok' | 'invalid' | 'rateLimited' | 'error';

export const useAuthStore = defineStore('auth', () => {
  // Detect environment inside factory to allow easier mocking/stubbing in tests
  const isElectron = !!(window && window.electronAPI);
  const backend: IMediaBackend = isElectron
    ? new ElectronAdapter()
    : new WebAdapter();

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

  async function unlock(password: string): Promise<UnlockResult> {
    try {
      const success = await backend.unlock(password);
      if (success) {
        isLocked.value = false;
        return 'ok';
      }
      return 'invalid';
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return 'rateLimited';
      }
      console.error('Unlock failed:', error);
      return 'error';
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
