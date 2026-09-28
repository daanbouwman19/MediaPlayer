/**
 * @file Optional PIN lock for the desktop app. The PIN hash lives in the
 * settings table; whether the app is unlocked is kept in memory only, so a
 * restart or renderer reload asks for the PIN again.
 *
 * This is a privacy screen for the UI, not access control: other IPC
 * channels and the local media server (which keeps its own per-session
 * token) are not gated by it.
 */
import {
  hashSecret,
  isAcceptableSecret,
  verifySecret,
} from '../core/auth/secret-hash';
import { getSetting, saveSetting } from '../core/database/database';
import type { PinUnlockResult } from '../shared/ipc/auth.contract';

export const PIN_SETTING_KEY = 'lock_pin';
export const MIN_PIN_LENGTH = 4;
/** Failed attempts allowed before each further attempt is delayed. */
const FREE_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 5 * 60 * 1000;

let unlocked = false;
let failedAttempts = 0;
let blockedUntil = 0;

async function getPinHash(): Promise<string | null> {
  const value = await getSetting(PIN_SETTING_KEY);
  return value ? value : null;
}

export async function getAppLockStatus(): Promise<{
  enabled: boolean;
  isAuthenticated: boolean;
}> {
  const enabled = (await getPinHash()) !== null;
  return { enabled, isAuthenticated: !enabled || unlocked };
}

export function lockApp(): void {
  unlocked = false;
}

export async function unlockApp(pin: unknown): Promise<PinUnlockResult> {
  const hash = await getPinHash();
  if (!hash) {
    unlocked = true;
    return 'ok';
  }
  if (Date.now() < blockedUntil) return 'rateLimited';

  if (await verifySecret(pin, hash)) {
    unlocked = true;
    failedAttempts = 0;
    blockedUntil = 0;
    return 'ok';
  }

  failedAttempts++;
  if (failedAttempts >= FREE_ATTEMPTS) {
    const delay = Math.min(
      BASE_DELAY_MS * 2 ** (failedAttempts - FREE_ATTEMPTS),
      MAX_DELAY_MS,
    );
    blockedUntil = Date.now() + delay;
  }
  return 'invalid';
}

/** Changing or removing the PIN is only allowed from an unlocked app. */
async function assertUnlocked(): Promise<void> {
  const { isAuthenticated } = await getAppLockStatus();
  if (!isAuthenticated) throw new Error('App is locked');
}

export async function setAppPin(pin: unknown): Promise<void> {
  await assertUnlocked();
  if (!isAcceptableSecret(pin) || pin.length < MIN_PIN_LENGTH) {
    throw new Error(`PIN must be at least ${MIN_PIN_LENGTH} characters`);
  }
  await saveSetting(PIN_SETTING_KEY, await hashSecret(pin));
  // Whoever set the PIN is already in; don't lock them out mid-session.
  unlocked = true;
}

export async function clearAppPin(): Promise<void> {
  await assertUnlocked();
  await saveSetting(PIN_SETTING_KEY, '');
}

/** Test hook: forget the in-memory lock state. */
export function resetAppLockState(): void {
  unlocked = false;
  failedAttempts = 0;
  blockedUntil = 0;
}
