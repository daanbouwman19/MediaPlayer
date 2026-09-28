/**
 * @file Per-device privacy preferences (panic key, auto-lock), kept in
 * localStorage. Losing them only resets the defaults.
 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const STORAGE_KEY = 'privacySettings';
export const DEFAULT_PANIC_KEY = 'Backquote';
export const MAX_AUTO_LOCK_MINUTES = 240;

export interface PrivacySettings {
  /** `KeyboardEvent.code` of the panic key. */
  panicKey: string;
  /** Minimize the desktop window on panic. */
  panicMinimize: boolean;
  /** Lock after this many idle minutes; 0 turns it off. */
  autoLockMinutes: number;
  /** Lock when the window is hidden or loses focus. */
  lockOnBlur: boolean;
}

const DEFAULTS: PrivacySettings = {
  panicKey: DEFAULT_PANIC_KEY,
  panicMinimize: false,
  autoLockMinutes: 0,
  lockOnBlur: false,
};

export function clampAutoLockMinutes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), MAX_AUTO_LOCK_MINUTES);
}

function loadSettings(): PrivacySettings {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ...DEFAULTS };
  }
  if (!raw) return { ...DEFAULTS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULTS };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULTS };
  const saved = parsed as Record<string, unknown>;
  return {
    panicKey:
      typeof saved.panicKey === 'string' && saved.panicKey
        ? saved.panicKey
        : DEFAULTS.panicKey,
    panicMinimize:
      typeof saved.panicMinimize === 'boolean'
        ? saved.panicMinimize
        : DEFAULTS.panicMinimize,
    autoLockMinutes:
      typeof saved.autoLockMinutes === 'number'
        ? clampAutoLockMinutes(saved.autoLockMinutes)
        : DEFAULTS.autoLockMinutes,
    lockOnBlur:
      typeof saved.lockOnBlur === 'boolean'
        ? saved.lockOnBlur
        : DEFAULTS.lockOnBlur,
  };
}

export const usePrivacyStore = defineStore('privacy', () => {
  const initial = loadSettings();
  const panicKey = ref(initial.panicKey);
  const panicMinimize = ref(initial.panicMinimize);
  const autoLockMinutes = ref(initial.autoLockMinutes);
  const lockOnBlur = ref(initial.lockOnBlur);
  // True while the settings panel records a new panic key, so pressing the
  // current one there doesn't trigger it.
  const isCapturingPanicKey = ref(false);

  watch([panicKey, panicMinimize, autoLockMinutes, lockOnBlur], () => {
    const settings: PrivacySettings = {
      panicKey: panicKey.value,
      panicMinimize: panicMinimize.value,
      autoLockMinutes: autoLockMinutes.value,
      lockOnBlur: lockOnBlur.value,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save privacy settings:', e);
    }
  });

  return {
    panicKey,
    panicMinimize,
    autoLockMinutes,
    lockOnBlur,
    isCapturingPanicKey,
  };
});
