import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import SmartPlaylistModal from '@/components/SmartPlaylistModal.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/api');

describe('SmartPlaylistModal Coverage', () => {
  let mockLibraryState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.resetAllMocks();
    mockLibraryState = reactive({
      smartPlaylists: [],
    });
    mockUIState = reactive({
      isSmartPlaylistModalVisible: false,
    });

    (useLibraryStore as unknown as Mock).mockReturnValue(mockLibraryState);

    (useUIStore as unknown as Mock).mockReturnValue(mockUIState);
  });

  it('handles invalid JSON in criteria when populating form', async () => {
    // Start invisible
    mockUIState.isSmartPlaylistModalVisible = false;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const playlistToEdit = {
      id: 1,
      name: 'Bad Data',
      criteria: '{ "invalid": json }', // Malformed JSON
    };

    const wrapper = mount(SmartPlaylistModal, {
      props: { playlistToEdit },
    });

    // Trigger watcher
    mockUIState.isSmartPlaylistModalVisible = true;
    await wrapper.vm.$nextTick();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to parse criteria',
      expect.any(Error),
    );
    // Name should still populate
    expect((wrapper.vm as any).name).toBe('Bad Data');
  });

  it('save does nothing if name is empty', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="text"]').setValue('   '); // Whitespace
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');

    expect(btn?.attributes('disabled')).toBeDefined();

    await (wrapper.vm as any).save();
    expect(api.createSmartPlaylist).not.toHaveBeenCalled();
  });

  it('save builds criteria correctly (undefined for 0s)', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="text"]').setValue('Criteria Test');
    // Leave numbers at 0
    (api.createSmartPlaylist as Mock).mockResolvedValue({ id: 1 });
    (api.getSmartPlaylists as Mock).mockResolvedValue([]);

    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');
    await btn?.trigger('click');
    await flushPromises();

    // If all values are 0/undefined, they are stripped from JSON
    expect(api.createSmartPlaylist).toHaveBeenCalledWith('Criteria Test', '{}');
  });

  it('handles API error during updates', async () => {
    mockUIState.isSmartPlaylistModalVisible = false;
    const playlistToEdit = { id: 1, name: 'Upd', criteria: '{}' };
    const wrapper = mount(SmartPlaylistModal, { props: { playlistToEdit } });

    mockUIState.isSmartPlaylistModalVisible = true;
    await wrapper.vm.$nextTick();

    (api.updateSmartPlaylist as Mock).mockRejectedValue(
      new Error('Update Fail'),
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Find Save Changes button
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Save Changes');
    await btn?.trigger('click');
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to save playlist:',
      expect.any(Error),
    );
  });

  it('close function sets modal visibility to false (Cancel button)', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    // Click Cancel button
    const btn = wrapper.findAll('button').find((b) => b.text() === 'Cancel');
    await btn?.trigger('click');

    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);
  });

  it('close function sets modal visibility to false (Backdrop click)', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    // Click backdrop (root element)
    await wrapper.find('.fixed').trigger('click');

    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);
  });

  it('close function sets modal visibility to false (Close icon)', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    // Click Close icon - it's a button with aria-label="Close"
    const btn = wrapper.find('button[aria-label="Close"]');
    await btn?.trigger('click');

    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);
  });

  it('watcher resets form when modal closes', async () => {
    vi.useFakeTimers();
    try {
      mockUIState.isSmartPlaylistModalVisible = true;
      const wrapper = mount(SmartPlaylistModal);
      await wrapper.vm.$nextTick();

      // Set some values
      await wrapper.find('input[type="text"]').setValue('Test Name');
      (wrapper.vm as any).minRating = 5;

      // Close modal
      mockUIState.isSmartPlaylistModalVisible = false;
      await wrapper.vm.$nextTick();

      // Wait for setTimeout to execute
      vi.advanceTimersByTime(300);

      expect((wrapper.vm as any).name).toBe('');
      expect((wrapper.vm as any).minRating).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('isEditing computed returns true when playlistToEdit exists', async () => {
    const playlistToEdit = { id: 1, name: 'Edit', criteria: '{}' };
    const wrapper = mount(SmartPlaylistModal, { props: { playlistToEdit } });
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).isEditing).toBe(true);
  });

  it('isEditing computed returns false when playlistToEdit is null', async () => {
    const wrapper = mount(SmartPlaylistModal, {
      props: { playlistToEdit: null },
    });
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).isEditing).toBe(false);
  });

  it('watcher populates form with duration conversion', async () => {
    mockUIState.isSmartPlaylistModalVisible = false;
    const playlistToEdit = {
      id: 1,
      name: 'Duration Test',
      criteria: JSON.stringify({ minDuration: 180 }), // 3 minutes in seconds
    };
    const wrapper = mount(SmartPlaylistModal, { props: { playlistToEdit } });

    mockUIState.isSmartPlaylistModalVisible = true;
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).minDurationMinutes).toBe(3);
  });

  it('successfully updates an existing playlist', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    const playlistToEdit = { id: 123, name: 'Old Name', criteria: '{}' };

    // Mock successful update
    (api.updateSmartPlaylist as Mock).mockResolvedValue(undefined);
    (api.getSmartPlaylists as Mock).mockResolvedValue([
      { id: 123, name: 'New Name' },
    ]);

    const wrapper = mount(SmartPlaylistModal, { props: { playlistToEdit } });
    await wrapper.vm.$nextTick();

    // Change values
    await wrapper.find('input[type="text"]').setValue('New Name');

    // Trigger Save Changes
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Save Changes');
    await btn?.trigger('click');
    await flushPromises();

    expect(api.updateSmartPlaylist).toHaveBeenCalledWith(
      123,
      'New Name',
      expect.any(String),
    );
    expect(api.getSmartPlaylists).toHaveBeenCalled();
    expect(mockUIState.isSmartPlaylistModalVisible).toBe(false);
  });
  it('save passes all non-zero criteria correctly', async () => {
    mockUIState.isSmartPlaylistModalVisible = true;
    (api.createSmartPlaylist as Mock).mockResolvedValue({ id: 10 });
    (api.getSmartPlaylists as Mock).mockResolvedValue([]);

    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="text"]').setValue('Full Criteria');

    // Use setValue to trigger v-model.number handlers
    await wrapper.find('input[type="range"]').setValue(4);

    const numberInputs = wrapper.findAll('input[type="number"]');
    // 0: minDuration, 1: minDaysSinceView, 2: minViews, 3: maxViews
    await numberInputs[0].setValue(10);
    await numberInputs[1].setValue(30);
    await numberInputs[2].setValue(100);
    await numberInputs[3].setValue(500);

    const btn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Create Playlist');
    await btn?.trigger('click');
    await flushPromises();

    const expectedCriteria = {
      minRating: 4,
      minDuration: 600, // 10 * 60
      minViews: 100,
      maxViews: 500,
      minDaysSinceView: 30,
    };

    expect(api.createSmartPlaylist).toHaveBeenCalledWith(
      'Full Criteria',
      JSON.stringify(expectedCriteria),
    );
  });

  it('watcher populates all fields correctly from existing playlist', async () => {
    mockUIState.isSmartPlaylistModalVisible = false;
    const criteria = {
      minRating: 3,
      minDuration: 120, // 2 mins
      minViews: 50,
      maxViews: 1000,
      minDaysSinceView: 7,
    };
    const playlistToEdit = {
      id: 5,
      name: 'Detail Test',
      criteria: JSON.stringify(criteria),
    };

    const wrapper = mount(SmartPlaylistModal, { props: { playlistToEdit } });

    // Trigger open
    mockUIState.isSmartPlaylistModalVisible = true;
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).name).toBe('Detail Test');
    expect((wrapper.vm as any).minRating).toBe(3);
    expect((wrapper.vm as any).minDurationMinutes).toBe(2);
    expect((wrapper.vm as any).minViews).toBe(50);
    expect((wrapper.vm as any).maxViews).toBe(1000);
    expect((wrapper.vm as any).minDaysSinceView).toBe(7);
  });

  it('opening modal in create mode does not populate form', async () => {
    mockUIState.isSmartPlaylistModalVisible = false;
    const wrapper = mount(SmartPlaylistModal); // No playlistToEdit

    mockUIState.isSmartPlaylistModalVisible = true;
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).name).toBe('');
    expect((wrapper.vm as any).minRating).toBe(0);
  });
});
