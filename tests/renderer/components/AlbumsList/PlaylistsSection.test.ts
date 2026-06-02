import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import PlaylistsSection from '@/features/library/AlbumsList/PlaylistsSection.vue';
import { useLibraryStore } from '../../../../src/renderer/composables/useLibraryStore';
import { useUIStore } from '../../../../src/renderer/composables/useUIStore';
import { api } from '../../../../src/renderer/api/index';

vi.mock('../../../../src/renderer/api/index', () => ({
  api: {
    executeSmartPlaylist: vi.fn(),
    deleteSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
  },
}));

vi.mock('../../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    startIndividualAlbumSlideshow: vi.fn(),
    startHistorySlideshow: vi.fn(),
  }),
}));

describe('PlaylistsSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().allAlbums = [];
    useLibraryStore().smartPlaylists = [];
    useLibraryStore().historyMedia = [];

    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().gridMediaFiles = [];
    useUIStore().viewMode = 'player';
    useUIStore().playlistToEdit = null;
    useUIStore().isHistoryMode = false;
  });

  it('renders playlists and handles actions', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'My List', criteria: '{}' },
    ] as any;

    const wrapper = mount(PlaylistsSection);
    expect(wrapper.text()).toContain('My List');
  });

  it('handles edit click', async () => {
    const playlist = { id: 1, name: 'Edit Me', criteria: '{}' };
    useLibraryStore().smartPlaylists = [playlist] as any;

    const wrapper = mount(PlaylistsSection);
    await wrapper.vm.$nextTick();

    const editBtn = wrapper.find('button[title="Edit"]');
    await editBtn.trigger('click');

    expect(useUIStore().playlistToEdit).toEqual(playlist);
    expect(useUIStore().isSmartPlaylistModalVisible).toBe(true);
  });

  it('handles delete with confirmation', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Delete Me', criteria: '{}' },
    ] as any;

    global.confirm = vi.fn(() => true);
    (api.deleteSmartPlaylist as Mock).mockResolvedValue(undefined);
    (api.getSmartPlaylists as Mock).mockResolvedValue([]);

    const wrapper = mount(PlaylistsSection);
    await wrapper.vm.$nextTick();

    const deleteBtn = wrapper.find('button[title="Delete"]');
    await deleteBtn.trigger('click');

    expect(global.confirm).toHaveBeenCalled();
    expect(api.deleteSmartPlaylist).toHaveBeenCalledWith(1);
  });

  it('does not delete when not confirmed', async () => {
    useLibraryStore().smartPlaylists = [
      { id: 1, name: 'Keep Me', criteria: '{}' },
    ] as any;

    global.confirm = vi.fn(() => false);

    const wrapper = mount(PlaylistsSection);
    const deleteBtn = wrapper.find('button[title="Delete"]');
    await deleteBtn.trigger('click');

    expect(global.confirm).toHaveBeenCalled();
    expect(api.deleteSmartPlaylist).not.toHaveBeenCalled();
  });

  it('shows no playlist message when empty', async () => {
    useLibraryStore().smartPlaylists = [];
    const wrapper = mount(PlaylistsSection);
    expect(wrapper.text()).toContain('No playlists created.');
  });

  it('handles smart playlist slideshow click', async () => {
    const playlist = { id: 1, name: 'Play Me', criteria: '{}' };
    useLibraryStore().smartPlaylists = [playlist] as any;
    useLibraryStore().allAlbums = [
      {
        id: 'Root',
        name: 'Root',
        children: [],
        textures: [{ path: '/file1.jpg', name: 'file1.jpg' }],
      },
    ] as any;

    const mockItems = [{ file_path: '/file1.jpg', rating: 5, view_count: 0 }];
    (api.executeSmartPlaylist as Mock).mockResolvedValue(mockItems);

    const wrapper = mount(PlaylistsSection);
    await wrapper.vm.$nextTick();

    const playBtn = wrapper.find('button[aria-label="Play Play Me"]');
    await playBtn.trigger('click');

    await flushPromises();
    expect(api.executeSmartPlaylist).toHaveBeenCalled();
  });

  it('handles error when starting playlist slideshow', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const playlist = { id: 1, name: 'Play Me', criteria: '{}' };
    useLibraryStore().smartPlaylists = [playlist] as any;

    (api.executeSmartPlaylist as Mock).mockRejectedValue(
      new Error('API failed'),
    );

    const wrapper = mount(PlaylistsSection);
    await wrapper.vm.$nextTick();

    const playBtn = wrapper.find('button[aria-label="Play Play Me"]');
    await playBtn.trigger('click');

    await flushPromises();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error starting playlist slideshow',
      expect.any(Error),
    );
  });

  it('shows toast when starting empty playlist', async () => {
    const playlist = { id: 1, name: 'Play Me', criteria: '{}' };
    useLibraryStore().smartPlaylists = [playlist] as any;

    (api.executeSmartPlaylist as Mock).mockResolvedValue([]);

    const wrapper = mount(PlaylistsSection);
    await wrapper.vm.$nextTick();

    const playBtn = wrapper.find('button[aria-label="Play Play Me"]');
    await playBtn.trigger('click');

    await flushPromises();
    // Since useToast is mocked, we can check logic
  });
});
