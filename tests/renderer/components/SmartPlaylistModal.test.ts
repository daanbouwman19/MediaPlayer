import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import SmartPlaylistModal from '@/components/SmartPlaylistModal.vue';
import { useUIStore } from '@/composables/useUIStore';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { api } from '@/api';

// Mock dependencies
vi.mock('@/composables/useUIStore');
vi.mock('@/composables/useLibraryStore');
vi.mock('@/api', () => ({
  api: {
    createSmartPlaylist: vi.fn(),
    updateSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
  },
}));

describe('SmartPlaylistModal.vue', () => {
  let mockUIState: any;
  let mockLibraryState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUIState = reactive({
      isSmartPlaylistModalVisible: false,
    });
    mockLibraryState = reactive({
      smartPlaylists: [],
    });
    (useUIStore as unknown as Mock).mockReturnValue(mockUIState);
    (useLibraryStore as unknown as Mock).mockReturnValue(mockLibraryState);
  });

  it('renders nothing when invisible', () => {
    const wrapper = mount(SmartPlaylistModal);
    expect(wrapper.find('.fixed').exists()).toBe(false);
  });

  it('renders correctly when visible', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('h2').text()).toBe('Create Smart Playlist');
  });

  it('has an accessible close button', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    const closeButton = wrapper.find('button[aria-label="Close"]');
    expect(closeButton.exists()).toBe(true);
    // Button should contain the icon component, not text
    expect(closeButton.find('svg').exists()).toBe(true);
  });

  it('validates input and disables create button', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');
    expect(createBtn?.attributes('disabled')).toBeDefined();

    const input = wrapper.find('input[type="text"]');
    await input.setValue('   ');
    expect(createBtn?.attributes('disabled')).toBeDefined();
  });

  it('enables create button when name is valid', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    const input = wrapper.find('input[type="text"]');
    await input.setValue('My Playlist');

    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');
    expect(createBtn?.attributes('disabled')).toBeUndefined();
  });

  it('calls API and closes on successful creation', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    // Fill form
    await wrapper.find('input[type="text"]').setValue('Best Videos');
    await wrapper.find('input[type="range"]').setValue(4); // Min rating
    await wrapper.findAll('input[type="number"]')[0].setValue(5); // Min duration 5 mins

    // Mock API success
    (api.createSmartPlaylist as Mock).mockResolvedValue({ id: 1 });
    (api.getSmartPlaylists as Mock).mockResolvedValue([
      { id: 1, name: 'Best Videos' },
    ]);

    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');
    await createBtn?.trigger('click');
    await flushPromises();

    expect(api.createSmartPlaylist).toHaveBeenCalledWith(
      'Best Videos',
      JSON.stringify({
        minRating: 4,
        minDuration: 300, // 5 * 60
        minViews: undefined,
        maxViews: undefined,
        minDaysSinceView: undefined,
      }),
    );
    expect(api.getSmartPlaylists).toHaveBeenCalled();
    expect(mockLibraryState.smartPlaylists).toHaveLength(1);
    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);
  });

  it('handles API errors gracefully', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="text"]').setValue('Error List');
    (api.createSmartPlaylist as Mock).mockRejectedValue(new Error('API Fail'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const createBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');
    await createBtn?.trigger('click');
    await flushPromises();

    expect(api.createSmartPlaylist).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to save playlist:',
      expect.any(Error),
    );
    // Should stay open
    expect(mockUIState.isSmartPlaylistModalVisible).toBe(true);
  });

  it('resets form data on close', async () => {
    vi.useFakeTimers();
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="text"]').setValue('Temporary');

    // Click close X
    await wrapper.findAll('button')[0].trigger('click');

    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);

    // Fast forward timer for reset
    vi.runAllTimers();

    // Check internal state (access via vm)
    expect((wrapper.vm as any).name).toBe('');
    vi.useRealTimers();
  });

  it('populates form and calls update API in edit mode', async () => {
    // Start invisible
    mockUIState.isSmartPlaylistModalVisible = false;
    const playlistToEdit = {
      id: 1,
      name: 'Existing List',
      criteria: JSON.stringify({ minRating: 4, minDuration: 0 }),
    };

    const wrapper = mount(SmartPlaylistModal, {
      props: { playlistToEdit },
    });

    // Trigger visibility
    mockUIState.isSmartPlaylistModalVisible = true;
    await wrapper.vm.$nextTick();

    // Check title and button text
    expect(wrapper.find('h2').text()).toContain('Edit Smart Playlist');
    expect(wrapper.text()).toContain('Save Changes');

    // Check form populated
    expect(
      (wrapper.find('input[type="text"]').element as HTMLInputElement).value,
    ).toBe('Existing List');

    // Update Name
    await wrapper.find('input[type="text"]').setValue('Updated List');

    // Mock API success
    (api.updateSmartPlaylist as Mock).mockResolvedValue(undefined);
    (api.getSmartPlaylists as Mock).mockResolvedValue([
      { id: 1, name: 'Updated List' },
    ]);

    const saveBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Save Changes');
    await saveBtn?.trigger('click');
    await flushPromises();

    expect(api.updateSmartPlaylist).toHaveBeenCalledWith(
      1,
      'Updated List',
      expect.stringContaining('"minRating":4'),
    );
    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);
  });
});
