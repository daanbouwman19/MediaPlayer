import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUIStore } from '@/composables/useUIStore';

describe('useUIStore', () => {
  let store: ReturnType<typeof useUIStore>;

  beforeEach(() => {
    store = useUIStore();
    // No explicit reset, but we can manually reset if needed
    store.viewMode = 'player';
    store.mediaFilter = 'All';
  });

  it('should initialize with default values', () => {
    expect(store.mediaFilter).toBe('All');
    expect(store.viewMode).toBe('player');
    expect(store.isSourcesModalVisible).toBe(false);
  });

  it('should update state correctly', () => {
    store.viewMode = 'grid';
    expect(store.viewMode).toBe('grid');

    store.isSourcesModalVisible = true;
    expect(store.isSourcesModalVisible).toBe(true);
  });

  it('should update theme mode', () => {
    store.setThemeMode('dark');
    expect(store.themeMode).toBe('dark');
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

      expect(reloadedStore.themeMode).toBe('system');
    });

    it('should use system by default if localStorage is empty', async () => {
      localStorage.clear();
      vi.resetModules();
      const { useUIStore: useUIStoreReloaded } =
        await import('../../../src/renderer/composables/useUIStore');
      const reloadedStore = useUIStoreReloaded();

      expect(reloadedStore.themeMode).toBe('system');
    });
  });
});
