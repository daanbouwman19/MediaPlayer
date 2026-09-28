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
  // Neutral cover shown by lock() when no password or PIN is set: it hides
  // the screen but any key or click dismisses it.
  const isCovered = ref(false);
  const supportsLocalPin = backend.supportsLocalPin;

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

  /**
   * Hides the library: behind the lock screen when a password or PIN is
   * set, otherwise behind the neutral cover.
   */
  async function lock() {
    if (!isEnabled.value) {
      isCovered.value = true;
      return;
    }
    // Show the lock screen first; ending the session can take a round trip.
    isLocked.value = true;
    try {
      await backend.lock();
    } catch (error) {
      console.error('Failed to end the unlocked session:', error);
    }
  }

  function uncover() {
    isCovered.value = false;
  }

  async function setPin(pin: string) {
    await backend.setPin(pin);
    isEnabled.value = true;
  }

  async function clearPin() {
    await backend.clearPin();
    isEnabled.value = false;
  }

  return {
    isLocked,
    isInitialized,
    isEnabled,
    isCovered,
    supportsLocalPin,
    checkLockStatus,
    unlock,
    lock,
    uncover,
    setPin,
    clearPin,
  };
});
