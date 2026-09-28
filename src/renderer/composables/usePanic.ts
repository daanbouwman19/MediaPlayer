/**
 * @file The panic key: one press pauses and mutes playback, stops the
 * slideshow countdown and hides the library (lock screen, or the neutral
 * cover when no password or PIN is set).
 */
import { onBeforeUnmount, onMounted } from 'vue';
import { api } from '../api';
import { useAuthStore } from './useAuthStore';
import { usePlayerStore } from './usePlayerStore';
import { usePrivacyStore } from './usePrivacyStore';

export function usePanic() {
  const authStore = useAuthStore();
  const playerStore = usePlayerStore();
  const privacyStore = usePrivacyStore();

  const panic = () => {
    playerStore.haltPlayback({ mute: true });
    void authStore.lock();
    if (privacyStore.panicMinimize) api.minimizeWindow();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.code !== privacyStore.panicKey) return;
    if (event.isComposing || event.repeat) return;
    // Recording a new panic key, or typing the password on the lock screen.
    if (privacyStore.isCapturingPanicKey || authStore.isLocked) return;
    // Runs in the capture phase ahead of every other handler, including
    // open dialogs and focused inputs, and keeps the key from reaching them.
    event.preventDefault();
    event.stopPropagation();
    panic();
  };

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown, { capture: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown, { capture: true });
  });

  return { panic };
}
