import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { SmartPlaylist, MediaFile } from '../../core/types';
import type { MediaFilter } from '../../core/constants';
import type { ThemeId } from '../../core/themes';
import { AVAILABLE_THEMES } from '../../core/themes';

export const useUIStore = defineStore('ui', () => {
  const savedTheme = (localStorage.getItem('themeMode') as ThemeId) || 'system';

  // Validate saved theme against current available themes
  const initialThemeMode = AVAILABLE_THEMES.find((t) => t.id === savedTheme)
    ? savedTheme
    : 'system';

  const mediaFilter = ref<MediaFilter>('All');
  const viewMode = ref<'player' | 'grid'>('player');
  const gridMediaFiles = ref<MediaFile[]>([]);
  const isSourcesModalVisible = ref(false);
  const isSmartPlaylistModalVisible = ref(false);
  const playlistToEdit = ref<SmartPlaylist | null>(null);
  const isControlsVisible = ref(true);
  const isSidebarVisible = ref(true);
  const isHistoryMode = ref(false);
  const themeMode = ref<ThemeId>(initialThemeMode);

  const setThemeMode = (mode: ThemeId) => {
    themeMode.value = mode;
  };

  return {
    mediaFilter,
    viewMode,
    gridMediaFiles,
    isSourcesModalVisible,
    isSmartPlaylistModalVisible,
    playlistToEdit,
    isControlsVisible,
    isSidebarVisible,
    isHistoryMode,
    themeMode,
    setThemeMode,
  };
});
