import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import SmartPlaylistModal from '@/features/library/SmartPlaylistModal.vue';
import { useUIStore } from '@/composables/useUIStore';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { api } from '@/api';

// Mock dependencies
vi.mock('@/api', () => ({
  api: {
    createSmartPlaylist: vi.fn(),
    updateSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
  },
}));

describe('SmartPlaylistModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useUIStore().isSmartPlaylistModalVisible = false;
    useLibraryStore().smartPlaylists = [];
  });

  it('renders nothing when invisible', () => {
    const wrapper = mount(SmartPlaylistModal);
    expect(wrapper.find('.fixed').exists()).toBe(false);
  });

  it('renders correctly when visible', async () => {
    useUIStore().isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('h2').text()).toBe('Create Smart Playlist');
  });

  it('has an accessible close button', async () => {
    useUIStore().isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    const closeButton = wrapper.find('button[aria-label="Close"]');
    expect(closeButton.exists()).toBe(true);
    // Button should contain the icon component, not text
    expect(closeButton.find('svg').exists()).toBe(true);
  });

  it('validates input and disables create button', async () => {
    useUIStore().isSmartPlaylistModalVisible = true;
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
    useUIStore().isSmartPlaylistModalVisible = true;
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
    useUIStore().isSmartPlaylistModalVisible = true;
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
    expect(useLibraryStore().smartPlaylists).toHaveLength(1);
    expect(useUIStore().isSmartPlaylistModalVisible).toBe(false);
  });

  it('handles API errors gracefully', async () => {
    useUIStore().isSmartPlaylistModalVisible = true;
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
    expect(useUIStore().isSmartPlaylistModalVisible).toBe(true);
  });

  it('resets form data on close', async () => {
    vi.useFakeTimers();
    useUIStore().isSmartPlaylistModalVisible = true;
    const wrapper = mount(SmartPlaylistModal);
    await wrapper.vm.$nextTick();

    await wrapper.find('input[type="text"]').setValue('Temporary');

    // Click close X
    await wrapper.findAll('button')[0].trigger('click');

    expect(useUIStore().isSmartPlaylistModalVisible).toBe(false);

    // Fast forward timer for reset
    vi.runAllTimers();

    // Check internal state (access via vm)
    expect((wrapper.vm as any).name).toBe('');
    vi.useRealTimers();
  });

  it('populates form and calls update API in edit mode', async () => {
    // Start invisible
    useUIStore().isSmartPlaylistModalVisible = false;
    const playlistToEdit = {
      id: 1,
      name: 'Existing List',
      criteria: JSON.stringify({ minRating: 4, minDuration: 0 }),
    };

    const wrapper = mount(SmartPlaylistModal, {
      props: { playlistToEdit },
    });

    // Trigger visibility
    useUIStore().isSmartPlaylistModalVisible = true;
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
    expect(useUIStore().isSmartPlaylistModalVisible).toBe(false);
  });

  describe('save guard', () => {
    const findCreateButton = (wrapper: ReturnType<typeof mount>) =>
      wrapper.findAll('button').find((b) => b.text() === 'Create Playlist')!;

    it('ignores a double click while the first save is in flight', async () => {
      useUIStore().isSmartPlaylistModalVisible = true;
      const wrapper = mount(SmartPlaylistModal);
      await wrapper.vm.$nextTick();
      await wrapper.find('input[type="text"]').setValue('Double Click');

      let resolveCreate!: (value: unknown) => void;
      (api.createSmartPlaylist as Mock).mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
      );
      (api.getSmartPlaylists as Mock).mockResolvedValue([]);

      const createBtn = findCreateButton(wrapper);
      await createBtn.trigger('click');
      await createBtn.trigger('click');

      expect(api.createSmartPlaylist).toHaveBeenCalledTimes(1);
      expect(createBtn.attributes('disabled')).toBeDefined();

      // A direct second call is refused as well, not just the disabled button
      await (wrapper.vm as any).save();
      expect(api.createSmartPlaylist).toHaveBeenCalledTimes(1);

      resolveCreate({ id: 1 });
      await flushPromises();

      expect(api.createSmartPlaylist).toHaveBeenCalledTimes(1);
      expect(useUIStore().isSmartPlaylistModalVisible).toBe(false);
    });

    it('ignores clicks on the button while the closed dialog fades out', async () => {
      useUIStore().isSmartPlaylistModalVisible = true;
      const wrapper = mount(SmartPlaylistModal);
      await wrapper.vm.$nextTick();
      await wrapper.find('input[type="text"]').setValue('Fade Out');
      (api.createSmartPlaylist as Mock).mockResolvedValue({ id: 1 });
      (api.getSmartPlaylists as Mock).mockResolvedValue([]);

      await findCreateButton(wrapper).trigger('click');
      await flushPromises();
      expect(useUIStore().isSmartPlaylistModalVisible).toBe(false);

      // The leaving element is still in the DOM during the transition
      await (wrapper.vm as any).save();
      expect(api.createSmartPlaylist).toHaveBeenCalledTimes(1);
    });

    it('re-enables saving after a failed attempt', async () => {
      useUIStore().isSmartPlaylistModalVisible = true;
      const wrapper = mount(SmartPlaylistModal);
      await wrapper.vm.$nextTick();
      await wrapper.find('input[type="text"]').setValue('Retry');
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      (api.createSmartPlaylist as Mock).mockRejectedValueOnce(
        new Error('offline'),
      );

      await findCreateButton(wrapper).trigger('click');
      await flushPromises();

      expect(findCreateButton(wrapper).attributes('disabled')).toBeUndefined();
      expect(useUIStore().isSmartPlaylistModalVisible).toBe(true);
      consoleSpy.mockRestore();
    });

    it('does not report a failed save when only the list refresh fails', async () => {
      useUIStore().isSmartPlaylistModalVisible = true;
      const wrapper = mount(SmartPlaylistModal);
      await wrapper.vm.$nextTick();
      await wrapper.find('input[type="text"]').setValue('Saved Anyway');
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      (api.createSmartPlaylist as Mock).mockResolvedValue({ id: 1 });
      (api.getSmartPlaylists as Mock).mockRejectedValue(new Error('offline'));

      await findCreateButton(wrapper).trigger('click');
      await flushPromises();

      expect(useUIStore().isSmartPlaylistModalVisible).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to refresh smart playlists:',
        expect.any(Error),
      );
      expect(consoleSpy).not.toHaveBeenCalledWith(
        'Failed to save playlist:',
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('delayed reset', () => {
    const playlistA = {
      id: 7,
      name: 'Playlist A',
      criteria: JSON.stringify({ minRating: 3 }),
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('is cancelled when the modal is reopened within the delay', async () => {
      vi.useFakeTimers();
      const wrapper = mount(SmartPlaylistModal, {
        props: { playlistToEdit: playlistA },
      });

      useUIStore().isSmartPlaylistModalVisible = true;
      await wrapper.vm.$nextTick();
      expect((wrapper.vm as any).name).toBe('Playlist A');

      // Escape, then Enter on the still-focused Edit button 100 ms later
      useUIStore().isSmartPlaylistModalVisible = false;
      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(100);
      useUIStore().isSmartPlaylistModalVisible = true;
      await wrapper.vm.$nextTick();

      vi.advanceTimersByTime(1000);
      await wrapper.vm.$nextTick();

      expect(wrapper.emitted('close')).toBeUndefined();
      expect((wrapper.vm as any).name).toBe('Playlist A');
      expect((wrapper.vm as any).minRating).toBe(3);
      expect(wrapper.find('h2').text()).toContain('Edit Smart Playlist');
    });

    it('starts a create session with an empty form even before the reset ran', async () => {
      vi.useFakeTimers();
      const wrapper = mount(SmartPlaylistModal, {
        props: { playlistToEdit: playlistA },
      });
      useUIStore().isSmartPlaylistModalVisible = true;
      await wrapper.vm.$nextTick();

      useUIStore().isSmartPlaylistModalVisible = false;
      await wrapper.vm.$nextTick();
      vi.advanceTimersByTime(100);

      await wrapper.setProps({ playlistToEdit: null });
      useUIStore().isSmartPlaylistModalVisible = true;
      await wrapper.vm.$nextTick();

      expect((wrapper.vm as any).name).toBe('');
      expect((wrapper.vm as any).minRating).toBe(0);
      expect(wrapper.find('h2').text()).toContain('Create Smart Playlist');
    });

    it('is cancelled when the component unmounts', async () => {
      vi.useFakeTimers();
      const wrapper = mount(SmartPlaylistModal, {
        props: { playlistToEdit: playlistA },
      });
      useUIStore().isSmartPlaylistModalVisible = true;
      await wrapper.vm.$nextTick();
      useUIStore().isSmartPlaylistModalVisible = false;
      await wrapper.vm.$nextTick();
      expect(vi.getTimerCount()).toBe(1);

      wrapper.unmount();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('focus management', () => {
    it('moves focus to the name field on open and back to the trigger on close', async () => {
      const trigger = document.createElement('button');
      trigger.textContent = 'Add Playlist';
      document.body.appendChild(trigger);
      trigger.focus();

      const wrapper = mount(SmartPlaylistModal, { attachTo: document.body });
      useUIStore().isSmartPlaylistModalVisible = true;
      await flushPromises();

      expect(document.activeElement).toBe(
        wrapper.find('#playlist-name').element,
      );

      useUIStore().isSmartPlaylistModalVisible = false;
      await flushPromises();
      expect(document.activeElement).toBe(trigger);

      wrapper.unmount();
      trigger.remove();
    });
  });
});
