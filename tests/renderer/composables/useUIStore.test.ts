import { describe, it, expect, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useUIStore } from '@/composables/useUIStore';

describe('useUIStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('should initialize with default values', () => {
    const store = useUIStore();
    expect(store.mediaFilter).toBe('All');
    expect(store.viewMode).toBe('player');
    expect(store.isSourcesModalVisible).toBe(false);
  });

  it('should update state correctly', () => {
    const store = useUIStore();
    store.viewMode = 'grid';
    expect(store.viewMode).toBe('grid');

    store.isSourcesModalVisible = true;
    expect(store.isSourcesModalVisible).toBe(true);
  });

  it('should update theme mode', () => {
    const store = useUIStore();
    store.setThemeMode('dark');
    expect(store.themeMode).toBe('dark');
  });

  describe('Theme Initialization', () => {
    it('should fallback to system if localStorage contains an invalid theme', async () => {
      localStorage.clear();
      localStorage.setItem('themeMode', 'invalid-theme');

      // No need to resetModules anymore as logic is inside defineStore factory
      const store = useUIStore();
      expect(store.themeMode).toBe('system');
    });

    it('should use system by default if localStorage is empty', async () => {
      localStorage.clear();
      const store = useUIStore();
      expect(store.themeMode).toBe('system');
    });

    it('should load saved theme from localStorage', async () => {
      localStorage.setItem('themeMode', 'dark');
      const store = useUIStore();
      expect(store.themeMode).toBe('dark');
    });
  });
});
