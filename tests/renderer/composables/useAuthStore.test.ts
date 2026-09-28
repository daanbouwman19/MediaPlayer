import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '@/composables/useAuthStore';
import { HttpError } from '@/api/http-error';

const { mockGetLockStatus, mockUnlock, mockLock, mockSetPin, mockClearPin } =
  vi.hoisted(() => ({
    mockGetLockStatus: vi.fn(),
    mockUnlock: vi.fn(),
    mockLock: vi.fn(),
    mockSetPin: vi.fn(),
    mockClearPin: vi.fn(),
  }));

vi.mock('@/api/WebAdapter', () => {
  return {
    WebAdapter: class {
      getLockStatus = mockGetLockStatus;
      unlock = mockUnlock;
      lock = mockLock;
      setPin = mockSetPin;
      clearPin = mockClearPin;
      supportsLocalPin = false;
    },
  };
});

vi.mock('@/api/ElectronAdapter', () => {
  return {
    ElectronAdapter: class {
      getLockStatus = mockGetLockStatus;
      unlock = mockUnlock;
      lock = mockLock;
      setPin = mockSetPin;
      clearPin = mockClearPin;
      supportsLocalPin = false;
    },
  };
});

describe('useAuthStore', () => {
  let store: ReturnType<typeof useAuthStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    store = useAuthStore();
  });

  it('should initialize with default values', () => {
    expect(store.isLocked).toBe(false);
    expect(store.isInitialized).toBe(false);
    expect(store.isEnabled).toBe(false);
  });

  it('checkLockStatus updates state to locked when auth is required', async () => {
    mockGetLockStatus.mockResolvedValueOnce({
      enabled: true,
      isAuthenticated: false,
    });
    await store.checkLockStatus();
    expect(store.isEnabled).toBe(true);
    expect(store.isLocked).toBe(true);
    expect(store.isInitialized).toBe(true);
  });

  it('checkLockStatus updates state to unlocked when already authenticated', async () => {
    mockGetLockStatus.mockResolvedValueOnce({
      enabled: true,
      isAuthenticated: true,
    });
    await store.checkLockStatus();
    expect(store.isEnabled).toBe(true);
    expect(store.isLocked).toBe(false);
    expect(store.isInitialized).toBe(true);
  });

  it('checkLockStatus updates state correctly when password lock is disabled', async () => {
    mockGetLockStatus.mockResolvedValueOnce({
      enabled: false,
      isAuthenticated: true,
    });
    await store.checkLockStatus();
    expect(store.isEnabled).toBe(false);
    expect(store.isLocked).toBe(false);
    expect(store.isInitialized).toBe(true);
  });

  it('checkLockStatus handles errors by falling back to unlocked and initialized', async () => {
    mockGetLockStatus.mockRejectedValueOnce(new Error('Network error'));

    // Silence console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await store.checkLockStatus();

    expect(store.isInitialized).toBe(true);
    // Preserves original false values for lock attributes
    expect(store.isEnabled).toBe(false);
    expect(store.isLocked).toBe(false);

    consoleSpy.mockRestore();
  });

  it('unlock successful sets isLocked to false', async () => {
    store.isLocked = true;
    mockUnlock.mockResolvedValueOnce(true);

    const result = await store.unlock('correct-pwd');

    expect(result).toBe('ok');
    expect(store.isLocked).toBe(false);
    expect(mockUnlock).toHaveBeenCalledWith('correct-pwd');
  });

  it('unlock with a rejected password returns "invalid" and keeps isLocked true', async () => {
    store.isLocked = true;
    mockUnlock.mockResolvedValueOnce(false);

    const result = await store.unlock('wrong-pwd');

    expect(result).toBe('invalid');
    expect(store.isLocked).toBe(true);
    expect(mockUnlock).toHaveBeenCalledWith('wrong-pwd');
  });

  it('unlock reports HTTP 429 as "rateLimited", not as a wrong password', async () => {
    store.isLocked = true;
    mockUnlock.mockRejectedValueOnce(
      new HttpError(429, 'Too many auth attempts. Please try again later.'),
    );

    const result = await store.unlock('maybe-right');

    expect(result).toBe('rateLimited');
    expect(store.isLocked).toBe(true);
  });

  it.each([
    ['a server error', new HttpError(500, 'Internal server error')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('unlock reports %s as "error"', async (_label, failure) => {
    store.isLocked = true;
    mockUnlock.mockRejectedValueOnce(failure);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await store.unlock('maybe-right');

    expect(result).toBe('error');
    expect(store.isLocked).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith('Unlock failed:', failure);

    consoleSpy.mockRestore();
  });

  describe('lock', () => {
    it('shows the lock screen and ends the session when a lock is set', async () => {
      mockGetLockStatus.mockResolvedValueOnce({
        enabled: true,
        isAuthenticated: true,
      });
      await store.checkLockStatus();
      mockLock.mockResolvedValueOnce(undefined);

      await store.lock();

      expect(store.isLocked).toBe(true);
      expect(store.isCovered).toBe(false);
      expect(mockLock).toHaveBeenCalled();
    });

    it('stays locked when ending the session fails', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockGetLockStatus.mockResolvedValueOnce({
        enabled: true,
        isAuthenticated: true,
      });
      await store.checkLockStatus();
      mockLock.mockRejectedValueOnce(new Error('offline'));

      await store.lock();

      expect(store.isLocked).toBe(true);
      consoleSpy.mockRestore();
    });

    it('falls back to the neutral cover without a password', async () => {
      await store.lock();
      expect(store.isLocked).toBe(false);
      expect(store.isCovered).toBe(true);
      expect(mockLock).not.toHaveBeenCalled();

      store.uncover();
      expect(store.isCovered).toBe(false);
    });
  });

  it('setPin and clearPin toggle whether the lock is enabled', async () => {
    mockSetPin.mockResolvedValueOnce(undefined);
    await store.setPin('1234');
    expect(mockSetPin).toHaveBeenCalledWith('1234');
    expect(store.isEnabled).toBe(true);

    mockClearPin.mockResolvedValueOnce(undefined);
    await store.clearPin();
    expect(store.isEnabled).toBe(false);
  });
});
