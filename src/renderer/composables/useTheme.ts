import { watch } from 'vue';
import { useUIStore } from './useUIStore';

export function useTheme() {
  const uiStore = useUIStore();
  const { themeMode } = uiStore;

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

  const applyTheme = () => {
    let isDark = false;

    if (themeMode.value === 'system') {
      isDark = mediaQuery.matches;
    } else {
      isDark = themeMode.value === 'dark';
    }

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // Sync with Electron main process
    if (window.electronAPI) {
      window.electronAPI.setTheme(themeMode.value);
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

    // Watch for user theme selection changes
    watch(themeMode, (newTheme) => {
      localStorage.setItem('themeMode', newTheme);
      applyTheme();
    });

    // Apply the initial theme
    applyTheme();
  };

  return {
    initTheme,
    cycleTheme,
    applyTheme,
  };
}
