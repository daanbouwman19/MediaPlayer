import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, toRefs } from 'vue';
import AlbumsList from '../../../src/renderer/components/AlbumsList.vue';
import { collectTexturesRecursive } from '../../../src/renderer/utils/albumUtils';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';

// --- New Mocking Strategy ---
import { api } from '../../../src/renderer/api';

const mocks = vi.hoisted(() => ({
  mockToggleAlbumSelection: vi.fn(),
  mockSetBatchAlbumSelection: vi.fn(),
  mockStartSlideshow: vi.fn(),
  mockStartIndividualAlbumSlideshow: vi.fn(),
  mockStartHistorySlideshow: vi.fn(),
  mockToggleSlideshowTimer: vi.fn(),
  mockReapplyFilter: vi.fn(),
}));

vi.mock('../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    toggleAlbumSelection: mocks.mockToggleAlbumSelection,
    setBatchAlbumSelection: mocks.mockSetBatchAlbumSelection,
    startSlideshow: mocks.mockStartSlideshow,
    startIndividualAlbumSlideshow: mocks.mockStartIndividualAlbumSlideshow,
    startHistorySlideshow: mocks.mockStartHistorySlideshow,
    toggleSlideshowTimer: mocks.mockToggleSlideshowTimer,
    openAlbumInGrid: vi.fn(),
    reapplyFilter: mocks.mockReapplyFilter,
  }),
}));

vi.mock('../../../src/renderer/api', () => ({
  api: {
    getAllMetadataAndStats: vi.fn(),
    executeSmartPlaylist: vi.fn(),
    deleteSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
  },
}));

vi.mock('../../../src/renderer/composables/useLibraryStore');
vi.mock('../../../src/renderer/composables/usePlayerStore');
vi.mock('../../../src/renderer/composables/useUIStore');
// --- End New Mocking Strategy ---

// --- Factories ---
function createMockAlbums() {
  return [
    {
      id: 'Album1',
      name: 'Album1',
      textures: [{ name: 't1.jpg', path: '/t1.jpg' }],
      children: [
        {
          id: 'SubAlbum1',
          name: 'SubAlbum1',
          textures: [{ name: 'st1.jpg', path: '/st1.jpg' }],
          children: [],
        },
      ],
    },
    {
      id: 'Album2',
      name: 'Album2',
      textures: [{ name: 't2.jpg', path: '/t2.jpg' }],
      children: [],
    },
  ];
}

function createMockState() {
  const libraryState = reactive({
    allAlbums: createMockAlbums(),
    albumsSelectedForSlideshow: { Album1: true },
    smartPlaylists: [],
    historyMedia: [],
    mediaDirectories: [{ path: '/test', isActive: true }], // Default to having sources
  });

  const playerState = reactive({
    timerDuration: 5,
    isTimerRunning: false,
    timerProgress: 0,
    isSlideshowActive: false,
    playFullVideo: false,
    pauseTimerOnPlay: false,
  });

  const uiState = reactive({
    isSourcesModalVisible: false,
    isSmartPlaylistModalVisible: false,
    gridMediaFiles: [],
    viewMode: 'player',
    playlistToEdit: null,
    mediaFilter: 'All',
    isHistoryMode: false,
  });

  return { libraryState, playerState, uiState };
}

describe('AlbumsList.vue', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  // We keep a reference to default mock albums for assertions that rely on the initial structure
  const defaultMockAlbums = createMockAlbums();

  beforeEach(() => {
    vi.resetAllMocks();

    const { libraryState, playerState, uiState } = createMockState();
    mockLibraryState = libraryState;
    mockPlayerState = playerState;
    mockUIState = uiState;

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
      fetchHistory: vi.fn(),
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
    });

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
      ...toRefs(mockUIState),
    });

    (api.getSmartPlaylists as Mock).mockResolvedValue([]);
  });

  it('renders AlbumTree components for each root album', () => {
    const wrapper = mount(AlbumsList);
    const albumTrees = wrapper.findAllComponents({ name: 'AlbumTree' });
    expect(albumTrees.length).toBe(2);
    expect(albumTrees[0].props('album')).toEqual(defaultMockAlbums[0]);
    expect(albumTrees[1].props('album')).toEqual(defaultMockAlbums[1]);
  });

  it('shows "Add your first source" when no sources are configured', async () => {
    mockLibraryState.mediaDirectories = [];
    mockLibraryState.allAlbums = [];
    const wrapper = mount(AlbumsList);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Add your first source...');
    expect(wrapper.text()).not.toContain('No albums found using your sources');
  });

  it('shows "No albums found" when sources exist but no albums are loaded', async () => {
    mockLibraryState.mediaDirectories = [{ path: '/foo' }];
    mockLibraryState.allAlbums = [];
    const wrapper = mount(AlbumsList);
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('No albums found in your sources');
    expect(wrapper.text()).not.toContain('Add your first source...');
  });

  it('calls startSlideshow then toggleSlideshowTimer when the global start button is clicked and no slideshow is active', async () => {
    const wrapper = mount(AlbumsList);
    await wrapper.vm.$nextTick();
    const startButton = wrapper.find('[data-testid="timer-button"]');
    await startButton.trigger('click');
    expect(mocks.mockStartSlideshow).toHaveBeenCalled();
    expect(mocks.mockToggleSlideshowTimer).toHaveBeenCalled();
  });

  it('calls only toggleSlideshowTimer when the global start button is clicked and a slideshow is already active', async () => {
    mockPlayerState.isSlideshowActive = true;
    const wrapper = mount(AlbumsList);
    await wrapper.vm.$nextTick();
    const startButton = wrapper.find('[data-testid="timer-button"]');
    await startButton.trigger('click');
    expect(mocks.mockStartSlideshow).not.toHaveBeenCalled();
    expect(mocks.mockToggleSlideshowTimer).toHaveBeenCalled();
  });

  it('opens the sources modal when "Manage Sources" is clicked', async () => {
    const wrapper = mount(AlbumsList);
    const manageButton = wrapper.find('button[title="Manage Sources"]');
    await manageButton.trigger('click');
    expect(mockUIState.isSourcesModalVisible).toBe(true);
  });

  it('handles the albumClick event from AlbumTree', async () => {
    const wrapper = mount(AlbumsList);
    const albumTree = wrapper.findComponent({ name: 'AlbumTree' });

    albumTree.vm.$emit('albumClick', defaultMockAlbums[0]);
    await wrapper.vm.$nextTick();

    expect(mocks.mockStartIndividualAlbumSlideshow).toHaveBeenCalled();
    const expectedTextures = collectTexturesRecursive(defaultMockAlbums[0]);
    expect(mocks.mockStartIndividualAlbumSlideshow).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Album1',
        textures: expectedTextures,
      }),
    );
  });

  it('selects all children when a partially selected parent is toggled', async () => {
    // Set initial state to partially selected
    mockLibraryState.albumsSelectedForSlideshow = { Album1: true };
    const wrapper = mount(AlbumsList);
    const albumTree = wrapper.findComponent({ name: 'AlbumTree' });

    albumTree.vm.$emit('toggleSelection', {
      album: defaultMockAlbums[0],
      recursive: true,
    });
    await wrapper.vm.$nextTick();

    expect(mocks.mockSetBatchAlbumSelection).toHaveBeenCalledWith(
      expect.arrayContaining(['Album1', 'SubAlbum1']),
      true,
    );
  });

  it('deselects all children when a fully selected parent is toggled', async () => {
    // Set initial state to fully selected
    mockLibraryState.albumsSelectedForSlideshow = {
      Album1: true,
      SubAlbum1: true,
    };
    const wrapper = mount(AlbumsList);
    const albumTree = wrapper.findComponent({ name: 'AlbumTree' });

    albumTree.vm.$emit('toggleSelection', {
      album: defaultMockAlbums[0],
      recursive: true,
    });
    await wrapper.vm.$nextTick();

    expect(mocks.mockSetBatchAlbumSelection).toHaveBeenCalledWith(
      expect.arrayContaining(['Album1', 'SubAlbum1']),
      false,
    );
  });

  it('toggles slideshow timer when timer button is clicked', async () => {
    const wrapper = mount(AlbumsList);
    const timerButton = wrapper.find('.timer-button');
    await timerButton.trigger('click');
    expect(mocks.mockToggleSlideshowTimer).toHaveBeenCalled();
  });

  it('Timer button has accessible name (aria-label)', async () => {
    const wrapper = mount(AlbumsList);
    const timerButton = wrapper.find('[data-testid="timer-button"]');

    expect(timerButton.attributes('aria-label')).toBe('Start/Resume Slideshow');

    mockPlayerState.isTimerRunning = true;
    await wrapper.vm.$nextTick();

    expect(timerButton.attributes('aria-label')).toBe('Pause Slideshow');
  });

  describe('Smart Playlists', () => {
    it('opens smart playlist modal', async () => {
      const wrapper = mount(AlbumsList);
      const btn = wrapper.find('button[title="Add Playlist"]');
      await btn.trigger('click');
      expect(mockUIState.isSmartPlaylistModalVisible).toBe(true);
    });

    it('renders smart playlists', async () => {
      mockLibraryState.smartPlaylists = [
        { id: 1, name: 'My List', criteria: '{}' },
      ];
      const wrapper = mount(AlbumsList);
      await wrapper.vm.$nextTick();
      expect(wrapper.text()).toContain('My List');
    });

    it('handles playlist click and filtering', async () => {
      mockLibraryState.smartPlaylists = [
        {
          id: 1,
          name: 'Rated 5',
          criteria: JSON.stringify({ minRating: 5 }),
        },
      ];
      // Mock allAlbums to contain valid files
      mockLibraryState.allAlbums = [
        {
          id: 'Root',
          name: 'Root',
          children: [],
          textures: [
            { path: '/file1.jpg', name: 'file1.jpg' },
            { path: '/file2.jpg', name: 'file2.jpg' },
          ],
        },
      ];

      // The DB is expected to return only matching items
      const mockItems = [{ file_path: '/file1.jpg', rating: 5, view_count: 0 }];
      (api.executeSmartPlaylist as Mock).mockResolvedValue(mockItems);

      const wrapper = mount(AlbumsList);
      await wrapper.vm.$nextTick();

      // Find the smart playlist item first to ensure we click the correct Grid button
      const playlistItem = wrapper
        .findAll('li')
        .find((li) => li.text().includes('Rated 5'));
      const gridBtn = playlistItem!.find('button[title="Open in Grid"]');
      await gridBtn.trigger('click');

      await new Promise(process.nextTick);

      expect(api.executeSmartPlaylist).toHaveBeenCalled();
      // Should filter to only file1
      expect(mockUIState.gridMediaFiles).toHaveLength(1);
      expect(mockUIState.gridMediaFiles[0].path).toBe('/file1.jpg');
      expect(mockUIState.viewMode).toBe('grid');
    });

    it('deletes playlist upon confirmation', async () => {
      mockLibraryState.smartPlaylists = [
        { id: 1, name: 'Delete Me', criteria: '{}' },
      ];
      // Mock confirm
      global.confirm = vi.fn(() => true);
      (api.deleteSmartPlaylist as Mock).mockResolvedValue(undefined);
      (api.getSmartPlaylists as Mock).mockResolvedValue([]);

      const wrapper = mount(AlbumsList);
      await wrapper.vm.$nextTick();

      const trashBtn = wrapper.findAll('button[title="Delete"]')[0];
      await trashBtn?.trigger('click');

      expect(global.confirm).toHaveBeenCalled();
      expect(api.deleteSmartPlaylist).toHaveBeenCalledWith(1);
      expect(api.getSmartPlaylists).toHaveBeenCalled();
      expect(api.deleteSmartPlaylist).toHaveBeenCalledWith(1);
      expect(api.getSmartPlaylists).toHaveBeenCalled();
    });

    it('opens edit modal on edit click', async () => {
      const playlist = { id: 1, name: 'Edit Me', criteria: '{}' };
      mockLibraryState.smartPlaylists = [playlist];
      const wrapper = mount(AlbumsList);
      await wrapper.vm.$nextTick();

      const editBtn = wrapper.findAll('button[title="Edit"]')[0];
      // Edit button is hidden by default (opacity 0), but click should still work in test env
      // or we trigger the handler directly if visibility is blocked by CSS (but vue-test-utils usually ignores CSS visibility for interaction unless using strict visibility checks)
      await editBtn.trigger('click');

      expect(mockUIState.playlistToEdit).toEqual(playlist);
      expect(mockUIState.isSmartPlaylistModalVisible).toBe(true);
    });
  });

  describe('History Playlist', () => {
    it('handles history grid click', async () => {
      const wrapper = mount(AlbumsList);
      const historyItem = wrapper.find(
        'button[aria-label="Open History in Grid"]',
      );

      mockLibraryState.historyMedia = [{ path: '/history.jpg' }];

      await historyItem.trigger('click');
      await wrapper.vm.$nextTick();

      // Need to access the store returned by useLibraryStore to check calls
      const libraryStoreMock = useLibraryStore();
      expect(libraryStoreMock.fetchHistory).toHaveBeenCalledWith(100);
      expect(mockUIState.gridMediaFiles).toHaveLength(1);
      expect(mockUIState.viewMode).toBe('grid');
    });

    it('handles history slideshow click', async () => {
      const wrapper = mount(AlbumsList);
      const historyBtn = wrapper.find(
        'button[aria-label="Recently Played Slideshow"]',
      );

      mockLibraryState.historyMedia = [{ path: '/history.jpg' }];

      await historyBtn.trigger('click');
      await wrapper.vm.$nextTick();

      const libraryStoreMock = useLibraryStore();
      expect(libraryStoreMock.fetchHistory).toHaveBeenCalledWith(100);
      expect(mocks.mockStartHistorySlideshow).toHaveBeenCalledWith([
        { path: '/history.jpg' },
      ]);
    });

    it('logs error if no history found', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const wrapper = mount(AlbumsList);
      const historyBtn = wrapper.find(
        'button[aria-label="Recently Played Slideshow"]',
      );

      mockLibraryState.historyMedia = [];

      await historyBtn.trigger('click');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error starting history slideshow',
        expect.any(Error),
      );
    });
  });

  describe('Additional Coverage', () => {
    it('emits close event when mobile close button is clicked', async () => {
      const wrapper = mount(AlbumsList);
      // Helper to find button by icon or aria-label
      const closeBtn = wrapper.find('button[aria-label="Close Sidebar"]');
      await closeBtn.trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('updates settings via toggles', async () => {
      const wrapper = mount(AlbumsList);

      const checkboxes = wrapper.findAll('input[type="checkbox"]');
      const playFullVideoCheckbox = checkboxes[0];
      const pauseTimerCheckbox = checkboxes[1];

      await playFullVideoCheckbox.setValue(true);
      expect(mockPlayerState.playFullVideo).toBe(true);

      await pauseTimerCheckbox.setValue(true);
      expect(mockPlayerState.pauseTimerOnPlay).toBe(true);
    });

    it('sets media filter', async () => {
      const wrapper = mount(AlbumsList);
      const imgBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Images'));
      expect(imgBtn).toBeDefined();
      await imgBtn!.trigger('click');
      await flushPromises();

      expect(mocks.mockReapplyFilter).toHaveBeenCalled();
      expect(mockUIState.mediaFilter).toBe('Images');
    });

    it('handles delete playlist error', async () => {
      mockLibraryState.smartPlaylists = [
        { id: 1, name: 'Fail', criteria: '{}' },
      ];
      global.confirm = vi.fn(() => true);
      (api.deleteSmartPlaylist as Mock).mockRejectedValue(
        new Error('Delete failed'),
      );
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const wrapper = mount(AlbumsList);
      await wrapper.vm.$nextTick();
      const trashBtn = wrapper.findAll('button[title="Delete"]')[0];
      await trashBtn.trigger('click');

      // Just ensure it doesn't crash and logs error
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete playlist',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('handles history grid error', async () => {
      mockLibraryState.historyMedia = [{ path: '/history.jpg' }];
      // Mock fetchHistory to throw? Or useLibraryStore mock?
      // The component calls `await loadHistory()`, which calls `libraryStore.fetchHistory`.
      const libraryStoreMock = useLibraryStore();
      (libraryStoreMock.fetchHistory as Mock).mockRejectedValue(
        new Error('Fetch failed'),
      );

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const wrapper = mount(AlbumsList);

      const gridBtn = wrapper.find('button[aria-label="Open History in Grid"]');
      await gridBtn.trigger('click');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error opening history grid',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });
});
