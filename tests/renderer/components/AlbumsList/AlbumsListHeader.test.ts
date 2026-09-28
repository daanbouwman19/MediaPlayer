import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import AlbumsListHeader from '@/features/library/AlbumsList/AlbumsListHeader.vue';
import { useUIStore } from '@/composables/useUIStore';

describe('AlbumsListHeader', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().isSourcesModalVisible = false;
  });

  it('opens the smart playlist modal in create mode even if an edit selection is left over', async () => {
    // The modal clears the parent's edit selection only after its close
    // transition, so it can still be set when "Add Playlist" is pressed.
    useUIStore().playlistToEdit = {
      id: 3,
      name: 'Old',
      criteria: '{}',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const wrapper = mount(AlbumsListHeader);

    await wrapper.find('button[title="Add Playlist"]').trigger('click');

    expect(useUIStore().playlistToEdit).toBeNull();
    expect(useUIStore().isSmartPlaylistModalVisible).toBe(true);
  });

  it('opens the sources modal', async () => {
    const wrapper = mount(AlbumsListHeader);
    await wrapper.find('button[title="Manage Sources"]').trigger('click');
    expect(useUIStore().isSourcesModalVisible).toBe(true);
  });
});
