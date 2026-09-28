import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import {
  clampAutoLockMinutes,
  DEFAULT_PANIC_KEY,
  MAX_AUTO_LOCK_MINUTES,
  usePrivacyStore,
} from '@/composables/usePrivacyStore';

describe('usePrivacyStore', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts with defaults', () => {
    const store = usePrivacyStore();
    expect(store.panicKey).toBe(DEFAULT_PANIC_KEY);
    expect(store.panicMinimize).toBe(false);
    expect(store.autoLockMinutes).toBe(0);
    expect(store.lockOnBlur).toBe(false);
  });

  it('persists changes and reloads them', async () => {
    const store = usePrivacyStore();
    store.panicKey = 'KeyP';
    store.panicMinimize = true;
    store.autoLockMinutes = 10;
    store.lockOnBlur = true;
    await nextTick();

    setActivePinia(createPinia());
    const reloaded = usePrivacyStore();
    expect(reloaded.panicKey).toBe('KeyP');
    expect(reloaded.panicMinimize).toBe(true);
    expect(reloaded.autoLockMinutes).toBe(10);
    expect(reloaded.lockOnBlur).toBe(true);
  });

  it('ignores invalid saved values', () => {
    localStorage.setItem(
      'privacySettings',
      JSON.stringify({
        panicKey: '',
        panicMinimize: 'yes',
        autoLockMinutes: 99999,
        lockOnBlur: 1,
      }),
    );
    const store = usePrivacyStore();
    expect(store.panicKey).toBe(DEFAULT_PANIC_KEY);
    expect(store.panicMinimize).toBe(false);
    expect(store.autoLockMinutes).toBe(MAX_AUTO_LOCK_MINUTES);
    expect(store.lockOnBlur).toBe(false);
  });

  it('ignores saved values of the wrong type', () => {
    localStorage.setItem(
      'privacySettings',
      JSON.stringify({ autoLockMinutes: '5' }),
    );
    expect(usePrivacyStore().autoLockMinutes).toBe(0);
  });

  it.each(['not json', 'null', '"text"'])(
    'falls back to defaults for %s',
    (raw) => {
      localStorage.setItem('privacySettings', raw);
      expect(usePrivacyStore().panicKey).toBe(DEFAULT_PANIC_KEY);
    },
  );

  it('works when localStorage throws', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const store = usePrivacyStore();
    expect(store.panicKey).toBe(DEFAULT_PANIC_KEY);
    store.lockOnBlur = true;
    await nextTick();

    expect(setItem).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('clamps auto-lock minutes', () => {
    expect(clampAutoLockMinutes(-5)).toBe(0);
    expect(clampAutoLockMinutes(Number.NaN)).toBe(0);
    expect(clampAutoLockMinutes(7.9)).toBe(7);
    expect(clampAutoLockMinutes(10_000)).toBe(MAX_AUTO_LOCK_MINUTES);
  });
});
