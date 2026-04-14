import { reactive, toRefs } from 'vue';
import type { SmartPlaylist, MediaFile } from '../../core/types';
import type { MediaFilter } from '../../core/constants';
import type { ThemeId } from '../../core/themes';
import { AVAILABLE_THEMES } from '../../core/themes';

interface UIState {
  mediaFilter: MediaFilter;
  viewMode: 'player' | 'grid';
  gridMediaFiles: MediaFile[];
  isSourcesModalVisible: boolean;
  isSmartPlaylistModalVisible: boolean;
  playlistToEdit: SmartPlaylist | null;
  isControlsVisible: boolean;
  isSidebarVisible: boolean;
  isHistoryMode: boolean;
  themeMode: ThemeId;
}

const savedTheme = (localStorage.getItem('themeMode') as ThemeId) || 'system';

// Validate saved theme against current available themes
const themeMode = AVAILABLE_THEMES.find((t) => t.id === savedTheme)
  ? savedTheme
  : 'system';

const state = reactive<UIState>({
  mediaFilter: 'All',
  viewMode: 'player',
  gridMediaFiles: [],
  isSourcesModalVisible: false,
  isSmartPlaylistModalVisible: false,
  playlistToEdit: null,
  isControlsVisible: true,
  isSidebarVisible: true,
  isHistoryMode: false,
  themeMode,
});

export function useUIStore() {
  return {
    ...toRefs(state),
    state,
    setThemeMode: (mode: ThemeId) => {
      state.themeMode = mode;
    },
  };
}
