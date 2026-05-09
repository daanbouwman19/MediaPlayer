import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AlbumsList from '../../../src/renderer/components/AlbumsList.vue';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';

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
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().smartPlaylists = [];
    useLibraryStore().historyMedia = [];
    useLibraryStore().mediaDirectories = [];

    usePlayerStore().timerDuration = 0;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().timerProgress = 0;
    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().pauseTimerOnPlay = false;

    useUIStore().isSourcesModalVisible = false;
    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().gridMediaFiles = [];
    useUIStore().viewMode = 'player';
    useUIStore().playlistToEdit = null;
    useUIStore().mediaFilter = 'All';
    useUIStore().themeMode = 'system';
    useUIStore().isSidebarVisible = true;
    useUIStore().isHistoryMode = false;
    useUIStore().isControlsVisible = true;
  });

  it('renders the empty state button when no albums are present', async () => {
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
    expect(useUIStore().isSourcesModalVisible).toBe(true);
  });
});
