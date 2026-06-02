import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useUIStore } from './useUIStore';
import { AVAILABLE_THEMES } from '../../core/media/themes';

let mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * Shared logic to apply theme classes to the document
 */
const updateDOM = (themeId: string) => {
  // Remove all existing theme classes
  const classesToRemove = Array.from(document.documentElement.classList).filter(
    (cls) => cls === 'dark' || cls === 'light' || cls.startsWith('theme-'),
  );
  document.documentElement.classList.remove(...classesToRemove);

  // Apply the new theme class
  if (themeId === 'dark' || themeId === 'light') {
    document.documentElement.classList.add(themeId);
  } else if (themeId !== 'system') {
    document.documentElement.classList.add(`theme-${themeId}`);
  }
};

export function useTheme() {
  const uiStore = useUIStore();
  const { themeMode } = storeToRefs(uiStore);

  const applyTheme = () => {
    const currentThemeId = themeMode.value;
    const themeDef = AVAILABLE_THEMES.find((t) => t.id === currentThemeId);

    if (currentThemeId === 'system') {
      const isDark = mediaQuery.matches;
      updateDOM(isDark ? 'dark' : 'light');
    } else {
      updateDOM(currentThemeId);
    }

    if (window.electronAPI && themeDef) {
      // Map custom themes to a base native theme for window chrome
      window.electronAPI.setTheme(themeDef.base);
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

  const cycleTheme = () => {
    const currentIndex = AVAILABLE_THEMES.findIndex(
      (t) => t.id === themeMode.value,
    );
    const nextIndex = (currentIndex + 1) % AVAILABLE_THEMES.length;
    themeMode.value = AVAILABLE_THEMES[nextIndex].id;
  };

  return {
    initTheme,
    applyTheme,
    cleanupTheme,
    cycleTheme,
  };
}

/**
 * For testing purposes only: allow resetting the theme module state
 */
export const _resetThemeModule = () => {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
};
