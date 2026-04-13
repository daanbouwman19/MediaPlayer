import { watch } from 'vue';
import { useUIStore } from './useUIStore';

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

export function useTheme() {
  const uiStore = useUIStore();
  const { themeMode } = uiStore;

  const applyTheme = () => {
    const isDark =
      themeMode.value === 'system'
        ? mediaQuery.matches
        : themeMode.value === 'dark';

    document.documentElement.classList.toggle('dark', isDark);
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

  let unwatchTheme: (() => void) | null = null;

  const initTheme = () => {
    // Listen for OS theme changes
    mediaQuery.addEventListener('change', applyTheme);

    // Watch for user theme selection changes and sync with main process
    unwatchTheme = watch(
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
    if (unwatchTheme) {
      unwatchTheme();
      unwatchTheme = null;
    }
  };

  return {
    initTheme,
    cycleTheme,
    applyTheme,
    cleanupTheme,
  };
}
