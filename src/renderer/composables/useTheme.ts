import { watch } from 'vue';
import { useUIStore } from './useUIStore';

export function useTheme() {
  const uiStore = useUIStore();
  const { themeMode } = uiStore;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = () => {
    const isDark =
      themeMode.value === 'system'
        ? mediaQuery.matches
        : themeMode.value === 'dark';

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const cycleTheme = () => {
    if (themeMode.value === 'system') {
      themeMode.value = 'light';
    } else if (themeMode.value === 'light') {
      themeMode.value = 'dark';
    } else {
      themeMode.value = 'system';
    }
  };

  const initTheme = () => {
    // Listen for OS theme changes
    mediaQuery.addEventListener('change', applyTheme);

    // Watch for user theme selection changes and sync with main process
    watch(
      themeMode,
      (newTheme) => {
        localStorage.setItem('themeMode', newTheme);
        applyTheme();
        if (window.electronAPI) {
          window.electronAPI.setTheme(newTheme);
        }
      },
      { immediate: true },
    );
  };

  const cleanupTheme = () => {
    mediaQuery.removeEventListener('change', applyTheme);
  };

  return {
    initTheme,
    cycleTheme,
    applyTheme,
    cleanupTheme,
  };
}
