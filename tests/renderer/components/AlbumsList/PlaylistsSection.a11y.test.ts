import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AlbumsList from '@/features/library/AlbumsList.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';

// Mock the non-Pinia composable
vi.mock('@/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    toggleSlideshowTimer: vi.fn(),
    startSlideshow: vi.fn(),
    toggleAlbumSelection: vi.fn(),
    startIndividualAlbumSlideshow: vi.fn(),
  }),
}));

// Mock child components
vi.mock('@/features/library/AlbumTree.vue', () => ({
  default: { template: '<li>AlbumTree Item</li>' },
}));

// Mock Icons
vi.mock('@/components/atoms/icons/CloseIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/PlayIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/PauseIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/SettingsIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/PlaylistAddIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/PlaylistIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/GridIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/EditIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/DeleteIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));

describe('AlbumsList Accessibility', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().smartPlaylists = [];
    useLibraryStore().historyMedia = [];
    useLibraryStore().mediaDirectories = [];

    usePlayerStore().timerDuration = 5;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().timerProgress = 0;
    usePlayerStore().isSlideshowActive = false;

    useUIStore().isSourcesModalVisible = false;
    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().gridMediaFiles = [];
    useUIStore().viewMode = 'player';
    useUIStore().playlistToEdit = null;
  });

  it('smart playlist items should be semantic buttons with accessible labels', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'My Top Rated', criteria: '{}' },
    ] as any;

    const wrapper = mount(AlbumsList);
    await wrapper.vm.$nextTick();

    // Now we have "Recently Played" as the first item in the list
    // so we need to find the specific playlist item we injected
    const items = wrapper.findAll('li div.group');
    // Assuming Recently Played is first, "My Top Rated" is second
    const playlistItem = items[1];
    expect(playlistItem.exists()).toBe(true);

    // This checks for the NEW structure
    // Before refactor, there are buttons for grid/edit/delete, but the MAIN item text is NOT a button.
    // The main button we add will have class 'grow'.
    const growButton = playlistItem.find('button.grow');

    expect(
      growButton.exists(),
      'Main playlist item should be a semantic button',
    ).toBe(true);
    expect(growButton.attributes('aria-label')).toBe('Play My Top Rated');
  });

  it('controls should be visible on focus within', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Test List', criteria: '{}' },
    ] as any;

    const wrapper = mount(AlbumsList);
    await wrapper.vm.$nextTick();

    // Find the controls container (it has opacity-0 initially)
    // In current code: class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
    const controls = wrapper.find('.opacity-0');
    expect(controls.exists()).toBe(true);

    // Expect the new accessibility class
    expect(controls.classes()).toContain('group-focus-within:opacity-100');
  });
});
