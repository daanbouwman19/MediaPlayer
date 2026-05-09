import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '@/composables/useAuthStore';

const { mockGetLockStatus, mockUnlock } = vi.hoisted(() => ({
  mockGetLockStatus: vi.fn(),
  mockUnlock: vi.fn(),
}));

vi.mock('@/api/WebAdapter', () => {
  return {
    WebAdapter: class {
      getLockStatus = mockGetLockStatus;
      unlock = mockUnlock;
    },
  };
});

vi.mock('@/api/ElectronAdapter', () => {
  return {
    ElectronAdapter: class {
      getLockStatus = mockGetLockStatus;
      unlock = mockUnlock;
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

    expect(result).toBe(true);
    expect(store.isLocked).toBe(false);
    expect(mockUnlock).toHaveBeenCalledWith('correct-pwd');
  });

  it('unlock failure returns false and keeps isLocked true', async () => {
    store.isLocked = true;
    mockUnlock.mockResolvedValueOnce(false);

    const result = await store.unlock('wrong-pwd');

    expect(result).toBe(false);
    expect(store.isLocked).toBe(true);
    expect(mockUnlock).toHaveBeenCalledWith('wrong-pwd');
  });

  it('unlock handles errors gracefully and returns false', async () => {
    store.isLocked = true;
    mockUnlock.mockRejectedValueOnce(new Error('Network error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await store.unlock('wrong-pwd');

    expect(result).toBe(false);
    expect(store.isLocked).toBe(true);

    consoleSpy.mockRestore();
  });
});
