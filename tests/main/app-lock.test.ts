import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';

const settings = vi.hoisted(() => new Map<string, string>());

vi.mock('../../src/core/database/database', () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  saveSetting: vi.fn(async (key: string, value: string) => {
    settings.set(key, value);
  }),
}));

import {
  clearAppPin,
  getAppLockStatus,
  lockApp,
  resetAppLockState,
  setAppPin,
  unlockApp,
} from '../../src/main/app-lock';

describe('app-lock', () => {
  beforeEach(() => {
    settings.clear();
    resetAppLockState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is disabled without a PIN', async () => {
    expect(await getAppLockStatus()).toEqual({
      enabled: false,
      isAuthenticated: true,
    });
    expect(await unlockApp('anything')).toBe('ok');
  });

  it('sets a PIN, locks and unlocks', async () => {
    await setAppPin('1234');
    expect(await getAppLockStatus()).toEqual({
      enabled: true,
      isAuthenticated: true,
    });

    lockApp();
    expect((await getAppLockStatus()).isAuthenticated).toBe(false);
    expect(await unlockApp('0000')).toBe('invalid');
    expect(await unlockApp('1234')).toBe('ok');
    expect((await getAppLockStatus()).isAuthenticated).toBe(true);
  });

  it('rejects short PINs', async () => {
    await expect(setAppPin('12')).rejects.toThrow(/at least 4/);
    await expect(setAppPin(1234)).rejects.toThrow();
  });

  it('refuses to change or clear the PIN while locked', async () => {
    await setAppPin('1234');
    lockApp();
    await expect(setAppPin('5678')).rejects.toThrow('App is locked');
    await expect(clearAppPin()).rejects.toThrow('App is locked');
  });

  it('clears the PIN', async () => {
    await setAppPin('1234');
    await clearAppPin();
    lockApp();
    expect(await getAppLockStatus()).toEqual({
      enabled: false,
      isAuthenticated: true,
    });
  });

  it('throttles after repeated failures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await setAppPin('1234');
    lockApp();
    for (let i = 0; i < 5; i++) {
      expect(await unlockApp('0000')).toBe('invalid');
    }
    // Even the right PIN is refused while blocked.
    expect(await unlockApp('1234')).toBe('rateLimited');
    vi.advanceTimersByTime(1001);
    expect(await unlockApp('1234')).toBe('ok');
  });
});
