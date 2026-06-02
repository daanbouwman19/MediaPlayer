import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AlbumsSection from '@/features/library/AlbumsList/AlbumsSection.vue';
import { useLibraryStore } from '../../../../src/renderer/composables/useLibraryStore';
import { useUIStore } from '../../../../src/renderer/composables/useUIStore';

// Mock child components
vi.mock('@/features/library/AlbumTree.vue', () => ({
  default: { template: '<li>AlbumTree</li>' },
}));
vi.mock('@/components/atoms/icons/PlaylistAddIcon.vue', () => ({
  default: { template: '<svg>PlaylistAddIcon</svg>' },
}));

vi.mock('../../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: vi.fn(() => ({
    toggleAlbumSelection: vi.fn(),
    startIndividualAlbumSlideshow: vi.fn(),
  })),
}));

describe('AlbumsSection Empty State', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().mediaDirectories = [];

    useUIStore().isSourcesModalVisible = false;
    useUIStore().isHistoryMode = false;
  });

  it('renders the empty state button when no albums are present', async () => {
    const wrapper = mount(AlbumsSection);

    // Verify empty state button is present
    const emptyStateButton = wrapper.find('button.w-full.text-left');
    expect(emptyStateButton.exists()).toBe(true);
    expect(emptyStateButton.text()).toContain('Add your first source...');

    // Verify interaction
    await emptyStateButton.trigger('click');
    expect(useUIStore().isSourcesModalVisible).toBe(true);
  });
});
