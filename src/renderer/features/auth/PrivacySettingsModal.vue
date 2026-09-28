<template>
  <Transition
    enter-active-class="transition duration-300 ease-out"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div
      v-if="isPrivacyModalVisible"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      @click.self="close"
    >
      <div
        ref="dialogRef"
        class="relative w-full max-w-md glass-panel md:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-dvh md:max-h-[85vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-title"
      >
        <div
          class="absolute top-0 left-0 right-0 h-1 bg-linear-to-r from-accent via-accent-secondary to-accent z-10"
        ></div>

        <div
          class="flex shrink-0 justify-between items-center p-4 border-b border-white/5"
        >
          <h2 id="privacy-title" class="text-lg font-bold text-color">
            Privacy
          </h2>
          <button
            class="text-gray-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
            aria-label="Close"
            @click="close"
          >
            <CloseIcon class="w-5 h-5" />
          </button>
        </div>

        <div class="grow overflow-y-auto p-4 space-y-5 text-sm">
          <!-- Panic key -->
          <section class="space-y-2" aria-labelledby="privacy-panic-title">
            <h3 id="privacy-panic-title" class="section-title">Panic key</h3>
            <p class="text-muted text-xs">
              Pauses playback and hides the library in one press.
            </p>
            <div class="flex items-center justify-between gap-3">
              <span id="privacy-panic-key-label" class="text-muted">Key</span>
              <button
                class="privacy-btn min-w-24 font-mono"
                :class="{ 'ring-2 ring-accent-ink': isCapturingPanicKey }"
                aria-labelledby="privacy-panic-key-label"
                :aria-describedby="
                  captureError ? 'privacy-capture-error' : undefined
                "
                @click="startCapture"
                @keydown="handleCaptureKeydown"
                @blur="stopCapture"
              >
                {{ isCapturingPanicKey ? 'Press a key…' : panicKeyLabel }}
              </button>
            </div>
            <p
              v-if="captureError"
              id="privacy-capture-error"
              class="text-red-400 text-xs"
              role="alert"
            >
              {{ captureError }}
            </p>
            <label
              v-if="isDesktop"
              class="flex items-center justify-between gap-3 cursor-pointer"
            >
              <span class="text-muted">Also minimize the window</span>
              <input
                v-model="panicMinimize"
                type="checkbox"
                class="privacy-checkbox"
              />
            </label>
          </section>

          <!-- Auto-lock -->
          <section class="space-y-2" aria-labelledby="privacy-auto-title">
            <h3 id="privacy-auto-title" class="section-title">Auto-lock</h3>
            <label class="flex items-center justify-between gap-3">
              <span class="text-muted">
                Lock after idle minutes
                <span class="block text-xs opacity-70"
                  >0 = off. Playback counts as activity.</span
                >
              </span>
              <input
                :value="autoLockMinutes"
                type="number"
                min="0"
                :max="MAX_AUTO_LOCK_MINUTES"
                step="1"
                class="privacy-input w-20 text-right"
                @change="setAutoLockMinutes"
              />
            </label>
            <label
              class="flex items-center justify-between gap-3 cursor-pointer"
            >
              <span class="text-muted"
                >Lock when the window is hidden or loses focus</span
              >
              <input
                v-model="lockOnBlur"
                type="checkbox"
                class="privacy-checkbox"
              />
            </label>
          </section>

          <!-- Lock -->
          <section class="space-y-2" aria-labelledby="privacy-lock-title">
            <h3 id="privacy-lock-title" class="section-title">
              {{ isDesktop ? 'PIN' : 'Password' }}
            </h3>
            <p class="text-muted text-xs">
              <template v-if="isDesktop">
                {{
                  isEnabled
                    ? 'A PIN is set. Locking shows the PIN screen.'
                    : 'No PIN set. Locking only covers the screen until a key is pressed.'
                }}
              </template>
              <template v-else>
                {{
                  isEnabled
                    ? 'Locking asks for the server password.'
                    : 'No password is set, so locking only covers the screen. Set GLOBAL_PASSWORD on the server to require one.'
                }}
              </template>
            </p>

            <form v-if="isDesktop" class="space-y-2" @submit.prevent="savePin">
              <label class="flex items-center justify-between gap-3">
                <span class="text-muted">{{
                  isEnabled ? 'New PIN' : 'PIN'
                }}</span>
                <input
                  v-model="newPin"
                  type="password"
                  autocomplete="new-password"
                  class="privacy-input w-40"
                  :minlength="MIN_PIN_LENGTH"
                />
              </label>
              <label class="flex items-center justify-between gap-3">
                <span class="text-muted">Confirm</span>
                <input
                  v-model="confirmPin"
                  type="password"
                  autocomplete="new-password"
                  class="privacy-input w-40"
                />
              </label>
              <p v-if="pinError" class="text-red-400 text-xs" role="alert">
                {{ pinError }}
              </p>
              <div class="flex justify-end gap-2">
                <button
                  v-if="isEnabled"
                  type="button"
                  class="privacy-btn"
                  :disabled="isSavingPin"
                  @click="removePin"
                >
                  Remove PIN
                </button>
                <button
                  type="submit"
                  class="privacy-btn privacy-btn-primary"
                  :disabled="isSavingPin || !newPin"
                >
                  {{ isEnabled ? 'Change PIN' : 'Set PIN' }}
                </button>
              </div>
            </form>
          </section>
        </div>

        <div
          class="p-4 bg-white/5 border-t border-white/5 flex justify-between gap-2"
        >
          <button class="privacy-btn" @click="lockNow">Lock now</button>
          <button class="privacy-btn privacy-btn-primary" @click="close">
            Done
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
/**
 * @file Settings for the panic key, auto-lock and (desktop) the PIN.
 */
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import CloseIcon from '@/components/atoms/icons/CloseIcon.vue';
import { useUIStore } from '@/composables/useUIStore';
import { useAuthStore } from '@/composables/useAuthStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import {
  clampAutoLockMinutes,
  MAX_AUTO_LOCK_MINUTES,
  usePrivacyStore,
} from '@/composables/usePrivacyStore';
import { useFocusTrap } from '@/composables/useFocusTrap';
import { useEscapeKey } from '@/composables/useEscapeKey';
import { useToast } from '@/composables/useToast';
import { formatKeyCode } from '@/utils/keyboardUtils';

/** Mirrors the minimum the desktop main process enforces. */
const MIN_PIN_LENGTH = 4;

/** Keys the app already uses, or that the capture UI needs itself. */
const RESERVED_CODES = new Set([
  'KeyZ',
  'KeyX',
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'Slash',
  'Escape',
  'Tab',
  'Enter',
  'NumpadEnter',
]);
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph']);

const uiStore = useUIStore();
const authStore = useAuthStore();
const playerStore = usePlayerStore();
const privacyStore = usePrivacyStore();
const toast = useToast();

const { isPrivacyModalVisible } = storeToRefs(uiStore);
const { isEnabled } = storeToRefs(authStore);
const {
  panicKey,
  panicMinimize,
  autoLockMinutes,
  lockOnBlur,
  isCapturingPanicKey,
} = storeToRefs(privacyStore);
const isDesktop = authStore.supportsLocalPin;

const dialogRef = ref<HTMLElement | null>(null);
useFocusTrap(dialogRef, isPrivacyModalVisible);

const captureError = ref('');
const newPin = ref('');
const confirmPin = ref('');
const pinError = ref('');
const isSavingPin = ref(false);

const panicKeyLabel = computed(() => formatKeyCode(panicKey.value));

const close = () => {
  stopCapture();
  newPin.value = '';
  confirmPin.value = '';
  pinError.value = '';
  isPrivacyModalVisible.value = false;
};

useEscapeKey(isPrivacyModalVisible, close);

const startCapture = () => {
  captureError.value = '';
  isCapturingPanicKey.value = true;
};

function stopCapture() {
  isCapturingPanicKey.value = false;
}

const handleCaptureKeydown = (event: KeyboardEvent) => {
  if (!isCapturingPanicKey.value) return;
  if (event.key === 'Tab') {
    // Let focus move on; blur ends the capture.
    return;
  }
  // The key is being recorded: it must not close the dialog or reach any
  // app shortcut.
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') {
    stopCapture();
    return;
  }
  if (MODIFIER_KEYS.has(event.key)) return;
  if (RESERVED_CODES.has(event.code)) {
    captureError.value = `${formatKeyCode(event.code)} is already used by the app. Pick another key.`;
    return;
  }
  panicKey.value = event.code;
  captureError.value = '';
  stopCapture();
};

const setAutoLockMinutes = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const minutes = clampAutoLockMinutes(Number(input.value));
  autoLockMinutes.value = minutes;
  input.value = String(minutes);
};

const savePin = async () => {
  pinError.value = '';
  if (newPin.value.length < MIN_PIN_LENGTH) {
    pinError.value = `The PIN needs at least ${MIN_PIN_LENGTH} characters.`;
    return;
  }
  if (newPin.value !== confirmPin.value) {
    pinError.value = 'The PINs do not match.';
    return;
  }
  const wasEnabled = isEnabled.value;
  isSavingPin.value = true;
  try {
    await authStore.setPin(newPin.value);
    newPin.value = '';
    confirmPin.value = '';
    toast.success(wasEnabled ? 'PIN changed' : 'PIN set');
  } catch (error) {
    pinError.value =
      error instanceof Error ? error.message : 'Could not save the PIN.';
  } finally {
    isSavingPin.value = false;
  }
};

const removePin = async () => {
  pinError.value = '';
  isSavingPin.value = true;
  try {
    await authStore.clearPin();
    toast.success('PIN removed');
  } catch (error) {
    pinError.value =
      error instanceof Error ? error.message : 'Could not remove the PIN.';
  } finally {
    isSavingPin.value = false;
  }
};

const lockNow = () => {
  close();
  playerStore.haltPlayback();
  void authStore.lock();
};
</script>

<style scoped>
.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent-secondary);
}

.privacy-btn {
  padding: 0.4rem 0.9rem;
  border-radius: 0.5rem;
  background: rgb(0 0 0 / 0.2);
  border: 1px solid rgb(255 255 255 / 0.1);
  color: var(--text-color);
  font-weight: 600;
  transition: background-color 0.2s;
}

.privacy-btn:hover:not(:disabled) {
  background: rgb(255 255 255 / 0.1);
}

.privacy-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.privacy-btn:focus-visible,
.privacy-input:focus-visible,
.privacy-checkbox:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}

.privacy-btn-primary {
  background: var(--accent-color);
  color: var(--button-text-color);
  border-color: transparent;
}

.privacy-btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.privacy-input {
  padding: 0.35rem 0.6rem;
  border-radius: 0.5rem;
  background: rgb(0 0 0 / 0.2);
  border: 1px solid rgb(255 255 255 / 0.1);
  color: var(--text-color);
}

.privacy-checkbox {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent-color);
}
</style>
