import { describe, it, expect, beforeEach } from 'vitest';
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
});
