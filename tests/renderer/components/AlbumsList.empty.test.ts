import { mount } from '@vue/test-utils';
import { describe, it, expect, vi } from 'vitest';
import AlbumsList from '../../../src/renderer/components/AlbumsList.vue';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';

// Mock child components
vi.mock('../../../src/renderer/components/AlbumTree.vue', () => ({
  default: { template: '<li>AlbumTree</li>' },
}));
vi.mock('../../../src/renderer/components/icons/CloseIcon.vue', () => ({
  default: { template: '<svg>CloseIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/SettingsIcon.vue', () => ({
  default: { template: '<svg>SettingsIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/PlaylistAddIcon.vue', () => ({
  default: { template: '<svg>PlaylistAddIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/PlaylistIcon.vue', () => ({
  default: { template: '<svg>PlaylistIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/GridIcon.vue', () => ({
  default: { template: '<svg>GridIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/EditIcon.vue', () => ({
  default: { template: '<svg>EditIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/DeleteIcon.vue', () => ({
  default: { template: '<svg>DeleteIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/HistoryIcon.vue', () => ({
  default: { template: '<svg>HistoryIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/PlayIcon.vue', () => ({
  default: { template: '<svg>PlayIcon</svg>' },
}));
vi.mock('../../../src/renderer/components/icons/PauseIcon.vue', () => ({
  default: { template: '<svg>PauseIcon</svg>' },
}));

// Mock composables
vi.mock('../../../src/renderer/composables/useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));
vi.mock('../../../src/renderer/composables/usePlayerStore', () => ({
  usePlayerStore: vi.fn(() => ({
    timerDuration: 0,
    isTimerRunning: false,
    timerProgress: 0,
    isSlideshowActive: false,
    pauseTimerOnPlay: false,
  })),
}));
vi.mock('../../../src/renderer/composables/useUIStore', () => ({
  useUIStore: vi.fn(),
}));
vi.mock('../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: vi.fn(() => ({
    toggleAlbumSelection: vi.fn(),
    startIndividualAlbumSlideshow: vi.fn(),
    startSlideshow: vi.fn(),
    toggleSlideshowTimer: vi.fn(),
    reapplyFilter: vi.fn(),
  })),
}));
vi.mock('../../../src/renderer/api', () => ({
  api: {
    getAllMetadataAndStats: vi.fn(),
    deleteSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
  },
}));

describe('AlbumsList Empty State', () => {
  it('renders the empty state button when no albums are present', async () => {
    // Setup store mocks
    (useLibraryStore as any).mockReturnValue({
      allAlbums: [],
      albumsSelectedForSlideshow: {},
      smartPlaylists: [],
      fetchHistory: vi.fn(),
      state: { historyMedia: [], mediaDirectories: [] },
      mediaDirectories: [],
    });

    const isSourcesModalVisible = { value: false };
    (useUIStore as any).mockReturnValue({
      isSourcesModalVisible,
      isSmartPlaylistModalVisible: { value: false },
      gridMediaFiles: { value: [] },
      viewMode: { value: 'player' },
      playlistToEdit: { value: null },
      mediaFilter: { value: 'ALL' },
    });

    const wrapper = mount(AlbumsList, {
      global: {
        stubs: {
          Transition: true,
        },
      },
    });

    // Verify empty state button is present
    const emptyStateButton = wrapper.find('button.w-full.text-left');
    expect(emptyStateButton.exists()).toBe(true);
    expect(emptyStateButton.text()).toContain('Add your first source...');

    // Verify icons are present
    expect(wrapper.findComponent({ name: 'PlaylistAddIcon' }).exists()).toBe(
      true,
    );

    // Verify interaction
    await emptyStateButton.trigger('click');
    expect(isSourcesModalVisible.value).toBe(true);
  });
});
