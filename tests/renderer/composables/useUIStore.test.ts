import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/composables/useUIStore';

describe('useUIStore', () => {
  let store: ReturnType<typeof useUIStore>;

  beforeEach(() => {
    store = useUIStore();
    // No explicit reset, but we can manually reset if needed
    store.viewMode.value = 'player';
    store.mediaFilter.value = 'All';
  });

  it('should initialize with default values', () => {
    expect(store.mediaFilter.value).toBe('All');
    expect(store.viewMode.value).toBe('player');
    expect(store.isSourcesModalVisible.value).toBe(false);
  });

  it('should update state correctly', () => {
    store.viewMode.value = 'grid';
    expect(store.viewMode.value).toBe('grid');

    store.isSourcesModalVisible.value = true;
    expect(store.isSourcesModalVisible.value).toBe(true);
  });

  it('should update theme mode', () => {
    store.setThemeMode('dark');
    expect(store.themeMode.value).toBe('dark');
  });

  describe('Theme Initialization', () => {
    it('should fallback to system if localStorage contains an invalid theme', async () => {
      // Clear localStorage
      localStorage.clear();
      localStorage.setItem('themeMode', 'invalid-theme');

      // We need to re-import the module to trigger the top-level logic
      // Note: vitest and esm might make this tricky without resetModules
      vi.resetModules();
      const { useUIStore: useUIStoreReloaded } =
        await import('../../../src/renderer/composables/useUIStore');
      const reloadedStore = useUIStoreReloaded();

      expect(reloadedStore.themeMode.value).toBe('system');
    });

    it('should use system by default if localStorage is empty', async () => {
      localStorage.clear();
      vi.resetModules();
      const { useUIStore: useUIStoreReloaded } =
        await import('../../../src/renderer/composables/useUIStore');
      const reloadedStore = useUIStoreReloaded();

      expect(reloadedStore.themeMode.value).toBe('system');
    });
  });
});
