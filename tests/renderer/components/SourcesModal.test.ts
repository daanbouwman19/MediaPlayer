import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type Mock,
} from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import SourcesModal from '@/features/library/SourcesModal.vue';

import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { useToast } from '@/composables/useToast';
import { api } from '@/api';

const errorToasts = () =>
  useToast()
    .toasts.value.filter((t) => t.type === 'error')
    .map((t) => t.message);

vi.mock('@/api', () => ({
  api: {
    addMediaDirectory: vi.fn(),
    removeMediaDirectory: vi.fn(),
    setDirectoryActiveState: vi.fn(),
    getMediaDirectories: vi.fn(),
    reindexMediaLibrary: vi.fn(),
    startGoogleDriveAuth: vi.fn(),
    submitGoogleDriveAuthCode: vi.fn(),
    addGoogleDriveSource: vi.fn(),
    checkGoogleDriveAuth: vi.fn(),
    listDirectory: vi.fn().mockResolvedValue([]),
    getParentDirectory: vi.fn().mockResolvedValue(''),
    listGoogleDriveDirectory: vi.fn().mockResolvedValue([]),
    getGoogleDriveParent: vi.fn().mockResolvedValue('root'),
  },
}));

describe('SourcesModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToast().toasts.value = [];
    setActivePinia(
      createTestingPinia({ stubActions: false, createSpy: vi.fn }),
    );

    const libraryStore = useLibraryStore();
    libraryStore.mediaDirectories = [
      {
        path: '/path/to/dir1',
        isActive: true,
        id: '1',
        name: 'dir1',
        type: 'local',
      },
      {
        path: '/path/to/dir2',
        isActive: false,
        id: '2',
        name: 'dir2',
        type: 'local',
      },
    ] as any;
    libraryStore.albumsSelectedForSlideshow = {};

    useUIStore().isSourcesModalVisible = true;

    (api.addMediaDirectory as Mock).mockResolvedValue('/default/path');
    (api.removeMediaDirectory as Mock).mockResolvedValue(undefined);
    (api.setDirectoryActiveState as Mock).mockResolvedValue(undefined);
    (api.getMediaDirectories as Mock).mockResolvedValue([]);
    (api.reindexMediaLibrary as Mock).mockResolvedValue([]);
    (api.checkGoogleDriveAuth as Mock).mockResolvedValue(true);
  });

  it('should render modal when visible', () => {
    const wrapper = mount(SourcesModal);
    expect(wrapper.find('.fixed.inset-0').exists()).toBe(true);
    expect(wrapper.text()).toContain('Manage Media Sources');
  });

  it('should not render when not visible', () => {
    useUIStore().isSourcesModalVisible = false;
    const wrapper = mount(SourcesModal);
    expect(wrapper.find('.fixed.inset-0').exists()).toBe(false);
  });

  it('should display media directories', () => {
    const wrapper = mount(SourcesModal);
    expect(wrapper.text()).toContain('/path/to/dir1');
    expect(wrapper.text()).toContain('/path/to/dir2');
  });

  it('should show empty message when no directories', () => {
    useLibraryStore().mediaDirectories = [] as any;
    const wrapper = mount(SourcesModal);
    expect(wrapper.text()).toContain('No media sources configured yet');
  });

  describe('Google Drive disconnected warning', () => {
    const driveSource = {
      path: 'gdrive://123',
      isActive: true,
      id: '3',
      name: 'Drive',
      type: 'google_drive',
    };

    it('checks Drive auth when opened after the sources have loaded', async () => {
      // Like in App: the modal is mounted hidden before the library loads
      useUIStore().isSourcesModalVisible = false;
      useLibraryStore().mediaDirectories = [] as any;
      (api.checkGoogleDriveAuth as Mock).mockResolvedValue(false);

      const wrapper = mount(SourcesModal);
      await flushPromises();
      expect(api.checkGoogleDriveAuth).not.toHaveBeenCalled();

      // The library loads, then the user opens the modal
      useLibraryStore().mediaDirectories = [driveSource] as any;
      await flushPromises();
      useUIStore().isSourcesModalVisible = true;
      await flushPromises();

      expect(api.checkGoogleDriveAuth).toHaveBeenCalledTimes(1);
      expect(wrapper.text()).toContain('Google Drive Disconnected');

      const reauthBtn = wrapper
        .findAll('button')
        .find((b) => b.text() === 'Re-authenticate Drive');
      await reauthBtn?.trigger('click');
      expect((wrapper.vm as any).showDriveAuth).toBe(true);
    });

    it('re-checks every time the modal is opened', async () => {
      useUIStore().isSourcesModalVisible = false;
      useLibraryStore().mediaDirectories = [driveSource] as any;
      (api.checkGoogleDriveAuth as Mock).mockResolvedValue(true);

      const wrapper = mount(SourcesModal);
      useUIStore().isSourcesModalVisible = true;
      await flushPromises();
      expect(wrapper.text()).not.toContain('Google Drive Disconnected');

      useUIStore().isSourcesModalVisible = false;
      await flushPromises();
      (api.checkGoogleDriveAuth as Mock).mockResolvedValue(false);
      useUIStore().isSourcesModalVisible = true;
      await flushPromises();

      expect(api.checkGoogleDriveAuth).toHaveBeenCalledTimes(2);
      expect(wrapper.text()).toContain('Google Drive Disconnected');
    });

    it('recognises Drive sources stored with type "local" by their gdrive:// path', async () => {
      useLibraryStore().mediaDirectories = [
        { ...driveSource, type: 'local' },
      ] as any;
      (api.checkGoogleDriveAuth as Mock).mockResolvedValue(false);

      const wrapper = mount(SourcesModal);
      await flushPromises();

      expect(api.checkGoogleDriveAuth).toHaveBeenCalled();
      expect(wrapper.text()).toContain('Google Drive Disconnected');
      expect(wrapper.find('span[title="Google Drive"]').exists()).toBe(true);
    });

    it('does not check when there is no Drive source', async () => {
      mount(SourcesModal);
      await flushPromises();
      expect(api.checkGoogleDriveAuth).not.toHaveBeenCalled();
    });

    it('clears the warning once the last Drive source is removed', async () => {
      useLibraryStore().mediaDirectories = [driveSource] as any;
      (api.checkGoogleDriveAuth as Mock).mockResolvedValue(false);
      const wrapper = mount(SourcesModal);
      await flushPromises();
      expect(wrapper.text()).toContain('Google Drive Disconnected');

      await (wrapper.vm as any).confirmRemove('gdrive://123');
      await flushPromises();

      expect(wrapper.text()).not.toContain('Google Drive Disconnected');
    });

    it('ignores an outdated answer from a superseded check', async () => {
      useUIStore().isSourcesModalVisible = false;
      useLibraryStore().mediaDirectories = [driveSource] as any;
      let resolveFirst!: (value: boolean) => void;
      (api.checkGoogleDriveAuth as Mock)
        .mockReturnValueOnce(
          new Promise<boolean>((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockResolvedValueOnce(true);

      const wrapper = mount(SourcesModal);
      useUIStore().isSourcesModalVisible = true;
      await flushPromises();
      useUIStore().isSourcesModalVisible = false;
      await flushPromises();
      useUIStore().isSourcesModalVisible = true;
      await flushPromises();

      resolveFirst(false);
      await flushPromises();

      expect(wrapper.text()).not.toContain('Google Drive Disconnected');
    });

    it('logs instead of throwing when the check fails', async () => {
      useLibraryStore().mediaDirectories = [driveSource] as any;
      const error = new Error('offline');
      (api.checkGoogleDriveAuth as Mock).mockRejectedValue(error);
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const wrapper = mount(SourcesModal);
      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error checking Google Drive authentication:',
        error,
      );
      expect(wrapper.text()).not.toContain('Google Drive Disconnected');
      consoleSpy.mockRestore();
    });
  });

  it('should close modal when close button clicked', async () => {
    const wrapper = mount(SourcesModal);
    const closeButton = wrapper.find('button[aria-label="Close"]');
    await closeButton.trigger('click');
    expect(useUIStore().isSourcesModalVisible).toBe(false);
  });

  it('should close modal when clicking overlay', async () => {
    const wrapper = mount(SourcesModal);
    await wrapper.find('.fixed.inset-0').trigger('click.self');
    expect(useUIStore().isSourcesModalVisible).toBe(false);
  });

  it('should render checkboxes for directories', () => {
    const wrapper = mount(SourcesModal);
    const checkboxes = wrapper.findAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0].element as HTMLInputElement).checked).toBe(true);
    expect((checkboxes[1].element as HTMLInputElement).checked).toBe(false);
  });

  it('should call setDirectoryActiveState when checkbox changed', async () => {
    const wrapper = mount(SourcesModal);
    const checkbox = wrapper.findAll('input[type="checkbox"]')[0];
    await checkbox.setValue(false);
    expect(api.setDirectoryActiveState).toHaveBeenCalledWith(
      '/path/to/dir1',
      false,
    );
  });

  it('should call removeMediaDirectory when confirm button clicked', async () => {
    const wrapper = mount(SourcesModal);
    const removeBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('REMOVE'));
    await removeBtn?.trigger('click');

    const confirmBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('CONFIRM'));
    expect(confirmBtn?.exists()).toBe(true);
    await confirmBtn?.trigger('click');

    expect(api.removeMediaDirectory).toHaveBeenCalledWith('/path/to/dir1');
  });

  it('should not remove when cancel button clicked', async () => {
    const wrapper = mount(SourcesModal);
    const removeBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('REMOVE'));
    await removeBtn?.trigger('click');

    const cancelBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('CANCEL'));
    expect(cancelBtn?.exists()).toBe(true);
    await cancelBtn?.trigger('click');

    expect(api.removeMediaDirectory).not.toHaveBeenCalled();
    expect(
      wrapper.findAll('button').find((b) => b.text().includes('REMOVE')),
    ).toBeTruthy();
  });

  it('should open FileExplorer when add button clicked', async () => {
    const wrapper = mount(SourcesModal);
    const addButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add Local Folder'));
    expect(addButton?.exists()).toBe(true);

    await addButton?.trigger('click');
    await flushPromises();

    expect((wrapper.vm as any).isFileExplorerOpen).toBe(true);
    expect((wrapper.vm as any).fileExplorerMode).toBe('local');
  });

  it('should call addMediaDirectory when FileExplorer selects a path', async () => {
    (api.addMediaDirectory as Mock).mockResolvedValue('/selected/path');
    (api.getMediaDirectories as Mock).mockResolvedValue([
      {
        path: '/selected/path',
        isActive: true,
        id: '1',
        name: 'new',
        type: 'local',
      },
    ]);

    const wrapper = mount(SourcesModal);
    await (wrapper.vm as any).openLocalBrowser();
    expect((wrapper.vm as any).isFileExplorerOpen).toBe(true);

    await (wrapper.vm as any).handleFileExplorerSelect('/selected/path');
    await flushPromises();

    expect(api.addMediaDirectory).toHaveBeenCalledWith('/selected/path');
    expect(api.getMediaDirectories).toHaveBeenCalled();
    expect(useLibraryStore().mediaDirectories).toContainEqual({
      path: '/selected/path',
      isActive: true,
      id: '1',
      name: 'new',
      type: 'local',
    });
    expect((wrapper.vm as any).isFileExplorerOpen).toBe(false);
  });

  it('should call reindexMediaLibrary and select all albums when reindex button clicked', async () => {
    const newAlbums = [
      { id: 'newAlbum1-id', name: 'newAlbum1', children: [] },
      {
        id: 'newAlbum2-id',
        name: 'newAlbum2',
        children: [{ id: 'subAlbum-id', name: 'subAlbum', children: [] }],
      },
    ];
    (api.reindexMediaLibrary as Mock).mockResolvedValue(newAlbums);
    (api.getMediaDirectories as Mock).mockResolvedValue([]);

    const wrapper = mount(SourcesModal);
    const reindexButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('APPLY CHANGES & RE-INDEX'));
    expect(reindexButton?.exists()).toBe(true);

    await reindexButton?.trigger('click');
    await flushPromises();

    expect(api.reindexMediaLibrary).toHaveBeenCalled();
    expect(useLibraryStore().albumsSelectedForSlideshow).toEqual({
      'newAlbum1-id': true,
      'newAlbum2-id': true,
      'subAlbum-id': true,
    });
  });

  it.each([
    ['running', false],
    ['suspended for a long video', true],
  ])(
    'ends the slideshow and its %s countdown when re-indexing',
    async (_label, suspendForVideo) => {
      const playerStore = usePlayerStore();
      const onElapsed = vi.fn();
      playerStore.isSlideshowActive = true;
      playerStore.startSlideshowTimer(60_000, onElapsed);
      if (suspendForVideo) playerStore.suspendSlideshowTimerForVideo();

      const wrapper = mount(SourcesModal);
      const reindexButton = wrapper
        .findAll('button')
        .find((b) => b.text().includes('APPLY CHANGES & RE-INDEX'));
      await reindexButton?.trigger('click');
      await flushPromises();

      expect(playerStore.stopSlideshow).toHaveBeenCalled();
      expect(playerStore.isSlideshowActive).toBe(false);
      expect(playerStore.isTimerRunning).toBe(false);
      expect(playerStore.isTimerPausedForVideo).toBe(false);
      expect(playerStore.slideshowTimerId).toBeNull();
      expect(playerStore.timerEndTime).toBeNull();
      expect(onElapsed).not.toHaveBeenCalled();
    },
  );

  it('should handle error when reindexing fails', async () => {
    const error = new Error('Reindex failed');
    (api.reindexMediaLibrary as Mock).mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(SourcesModal);
    const reindexButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('APPLY CHANGES & RE-INDEX'));

    await reindexButton?.trigger('click');
    await flushPromises();

    expect(api.reindexMediaLibrary).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error re-indexing library:',
      error,
    );
    expect(useLibraryStore().isScanning).toBe(false);
    expect(errorToasts()).toEqual([
      'Re-indexing the library failed. Please try again.',
    ]);
    consoleSpy.mockRestore();
  });

  it('should handle error when adding directory fails', async () => {
    const error = new Error('Add failed');
    (api.addMediaDirectory as Mock).mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(SourcesModal);
    await (wrapper.vm as any).handleFileExplorerSelect('/fail/path');
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error adding media directory via explorer:',
      error,
    );
    expect(errorToasts()).toEqual(['Could not add folder: Add failed']);
    consoleSpy.mockRestore();
  });

  it('should handle error when toggling directory fails', async () => {
    const error = new Error('Toggle failed');
    (api.setDirectoryActiveState as Mock).mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(SourcesModal);
    const checkbox = wrapper.findAll('input[type="checkbox"]')[0];

    await checkbox.setValue(false);
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error toggling directory active state:',
      error,
    );
    // The checkbox goes back to the saved state instead of showing the
    // change that never happened, and the user is told about it.
    expect((checkbox.element as HTMLInputElement).checked).toBe(true);
    expect(useLibraryStore().mediaDirectories[0].isActive).toBe(true);
    expect(errorToasts()).toEqual([
      'Could not disable this source. Please try again.',
    ]);
    consoleSpy.mockRestore();
  });

  it('reverts a failed enable to unchecked', async () => {
    (api.setDirectoryActiveState as Mock).mockRejectedValue(new Error('429'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(SourcesModal);
    const checkbox = wrapper.findAll('input[type="checkbox"]')[1];

    await checkbox.setValue(true);
    await flushPromises();

    expect((checkbox.element as HTMLInputElement).checked).toBe(false);
    expect(errorToasts()).toEqual([
      'Could not enable this source. Please try again.',
    ]);
    vi.mocked(console.error).mockRestore();
  });

  it('should handle directory not found during toggle', async () => {
    const wrapper = mount(SourcesModal);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    await (wrapper.vm as any).handleToggleActive(
      '/non-existent/path',
      checkbox,
    );
    expect(useLibraryStore().mediaDirectories[0].isActive).toBe(true);
    expect(useLibraryStore().mediaDirectories[1].isActive).toBe(false);
  });

  it('should handle error when removing directory fails', async () => {
    const error = new Error('Remove failed');
    (api.removeMediaDirectory as Mock).mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(SourcesModal);
    const removeBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('REMOVE'));
    await removeBtn?.trigger('click');

    const confirmBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('CONFIRM'));
    await confirmBtn?.trigger('click');
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith('Error removing directory:', error);
    expect(errorToasts()).toEqual([
      'Could not remove this source. Please try again.',
    ]);
    // The source stays listed
    expect(wrapper.text()).toContain('/path/to/dir1');
    consoleSpy.mockRestore();
  });

  it('should handle directory not found during remove', async () => {
    const wrapper = mount(SourcesModal);
    await (wrapper.vm as any).confirmRemove('/non-existent/path');
    expect(useLibraryStore().mediaDirectories).toHaveLength(2);
  });

  describe('Google Drive Auth', () => {
    it('starts drive auth flow', async () => {
      (api.startGoogleDriveAuth as Mock).mockResolvedValue('http://auth-url');
      const wrapper = mount(SourcesModal);

      const addDriveBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Add Google Drive'));
      expect(addDriveBtn?.exists()).toBe(true);
      await addDriveBtn?.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Add Google Drive Source');

      const startAuthBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Start Authorization'));
      expect(startAuthBtn?.exists()).toBe(true);
      await startAuthBtn?.trigger('click');
      await flushPromises();

      expect(api.startGoogleDriveAuth).toHaveBeenCalled();
      expect((wrapper.vm as any).driveAuthUrl).toBe('http://auth-url');
      expect(wrapper.text()).toContain('Paste the code below');
    });

    it('submits auth code successfully', async () => {
      (api.submitGoogleDriveAuthCode as Mock).mockResolvedValue(true);
      const wrapper = mount(SourcesModal);

      (wrapper.vm as any).showDriveAuth = true;
      (wrapper.vm as any).driveAuthUrl = 'http://url';
      await flushPromises();

      const input = wrapper.find('#auth-code-input');
      await input.setValue('auth-code');

      const submitBtn = wrapper
        .findAll('button')
        .find((b) => b.text() === 'Submit Code');
      await submitBtn?.trigger('click');
      await flushPromises();

      expect(api.submitGoogleDriveAuthCode).toHaveBeenCalledWith('auth-code');
      expect((wrapper.vm as any).authSuccess).toBe(true);
      expect(wrapper.text()).toContain('Authentication successful');
    });

    it('handles auth code failure', async () => {
      (api.submitGoogleDriveAuthCode as Mock).mockResolvedValue(false);
      const wrapper = mount(SourcesModal);
      (wrapper.vm as any).showDriveAuth = true;
      (wrapper.vm as any).driveAuthUrl = 'http://url';
      await flushPromises();

      const input = wrapper.find('#auth-code-input');
      await input.setValue('bad-code');

      const submitBtn = wrapper
        .findAll('button')
        .find((b) => b.text() === 'Submit Code');
      await submitBtn?.trigger('click');
      await flushPromises();

      expect(api.submitGoogleDriveAuthCode).toHaveBeenCalledWith('bad-code');
      expect(wrapper.text()).toContain('Invalid code or authentication failed');
    });

    it('adds drive source successfully', async () => {
      (api.addGoogleDriveSource as Mock).mockResolvedValue({ name: 'Drive' });
      const wrapper = mount(SourcesModal);
      (wrapper.vm as any).showDriveAuth = true;
      (wrapper.vm as any).driveAuthUrl = 'http://url';
      (wrapper.vm as any).authSuccess = true;
      await flushPromises();

      const addBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Add Folder'));
      await addBtn?.trigger('click');
      await flushPromises();

      expect(api.addGoogleDriveSource).toHaveBeenCalledWith('root');
      expect(api.getMediaDirectories).toHaveBeenCalled();
      expect((wrapper.vm as any).showDriveAuth).toBe(false);
    });

    it('handles add drive source failure', async () => {
      (api.addGoogleDriveSource as Mock).mockRejectedValue(new Error('Failed'));
      const wrapper = mount(SourcesModal);
      (wrapper.vm as any).showDriveAuth = true;
      (wrapper.vm as any).driveAuthUrl = 'http://url';
      (wrapper.vm as any).authSuccess = true;
      await flushPromises();

      const addBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Add Folder'));
      await addBtn?.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Failed');
    });
  });

  describe('re-indexing after source changes (F39)', () => {
    const clickClose = async (wrapper: ReturnType<typeof mount>) => {
      await wrapper.find('button[aria-label="Close"]').trigger('click');
      await flushPromises();
    };

    it('re-indexes when closed with X after toggling a source', async () => {
      const wrapper = mount(SourcesModal);
      await wrapper.findAll('input[type="checkbox"]')[0].setValue(false);
      await flushPromises();

      await clickClose(wrapper);

      expect(useUIStore().isSourcesModalVisible).toBe(false);
      expect(api.reindexMediaLibrary).toHaveBeenCalledTimes(1);
    });

    it('re-indexes when closed with Escape after removing a source', async () => {
      const wrapper = mount(SourcesModal);
      await (wrapper.vm as any).confirmRemove('/path/to/dir1');

      // The component's Escape handler (window listeners of other test
      // instances would also react to a dispatched key event).
      (wrapper.vm as any).handleEscape();
      await flushPromises();

      expect(useUIStore().isSourcesModalVisible).toBe(false);
      expect(api.reindexMediaLibrary).toHaveBeenCalledTimes(1);
    });

    it('re-indexes when the backdrop is clicked after adding a folder', async () => {
      const wrapper = mount(SourcesModal);
      await (wrapper.vm as any).handleFileExplorerSelect('/new/folder');
      await flushPromises();

      await wrapper.find('.fixed.inset-0').trigger('click');
      await flushPromises();

      expect(api.reindexMediaLibrary).toHaveBeenCalledTimes(1);
    });

    it('re-indexes after adding a Drive source', async () => {
      (api.addGoogleDriveSource as Mock).mockResolvedValue({ name: 'Drive' });
      const wrapper = mount(SourcesModal);
      await (wrapper.vm as any).addDriveSource();
      await clickClose(wrapper);
      expect(api.reindexMediaLibrary).toHaveBeenCalledTimes(1);
    });

    it('does not re-index when nothing changed', async () => {
      const wrapper = mount(SourcesModal);
      await clickClose(wrapper);
      expect(api.reindexMediaLibrary).not.toHaveBeenCalled();
    });

    it('does not re-index for a failed change', async () => {
      (api.setDirectoryActiveState as Mock).mockRejectedValue(new Error('x'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const wrapper = mount(SourcesModal);
      await wrapper.findAll('input[type="checkbox"]')[0].setValue(false);
      await flushPromises();

      await clickClose(wrapper);

      expect(api.reindexMediaLibrary).not.toHaveBeenCalled();
    });

    it('Apply & Re-index re-indexes exactly once, even after changes', async () => {
      const wrapper = mount(SourcesModal);
      await wrapper.findAll('input[type="checkbox"]')[0].setValue(false);
      await flushPromises();

      const applyButton = wrapper
        .findAll('button')
        .find((b) => b.text().includes('APPLY CHANGES & RE-INDEX'));
      await applyButton?.trigger('click');
      await flushPromises();

      expect(api.reindexMediaLibrary).toHaveBeenCalledTimes(1);
    });
  });

  describe('refused folders (F106)', () => {
    it('shows why a folder could not be added', async () => {
      const message =
        '"/path/to/dir1/sub" is inside the media source "/path/to/dir1", which already includes it.';
      (api.addMediaDirectory as Mock).mockRejectedValue(new Error(message));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { toasts } = useToast();
      toasts.value = [];

      const wrapper = mount(SourcesModal);
      await (wrapper.vm as any).handleFileExplorerSelect('/path/to/dir1/sub');
      await flushPromises();

      expect(toasts.value).toContainEqual(
        expect.objectContaining({
          type: 'error',
          message: `Could not add folder: ${message}`,
        }),
      );
      // Nothing changed, so closing does not re-index.
      await wrapper.find('button[aria-label="Close"]').trigger('click');
      expect(api.reindexMediaLibrary).not.toHaveBeenCalled();
      toasts.value = [];
    });
  });

  describe('focus management', () => {
    it('keeps focus in the top-most dialog and restores it when each closes', async () => {
      useUIStore().isSourcesModalVisible = false;
      const trigger = document.createElement('button');
      trigger.textContent = 'Manage Sources';
      document.body.appendChild(trigger);
      trigger.focus();

      const wrapper = mount(SourcesModal, { attachTo: document.body });
      useUIStore().isSourcesModalVisible = true;
      await flushPromises();

      const sourcesDialog = wrapper.find('[aria-labelledby="modal-title"]');
      expect(sourcesDialog.element.contains(document.activeElement)).toBe(true);

      const addDriveBtn = wrapper
        .findAll('button')
        .find((b) => b.text().includes('Add Google Drive'))!;
      (addDriveBtn.element as HTMLButtonElement).focus();
      await addDriveBtn.trigger('click');
      await flushPromises();

      const driveDialog = wrapper.find('[aria-labelledby="drive-auth-title"]');
      expect(driveDialog.element.contains(document.activeElement)).toBe(true);

      // Escape closes only the Drive dialog; focus goes back to its opener
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      await flushPromises();
      expect(document.activeElement).toBe(addDriveBtn.element);

      // Closing the sources modal returns focus to what opened it
      await wrapper.find('button[aria-label="Close"]').trigger('click');
      await flushPromises();
      expect(document.activeElement).toBe(trigger);

      wrapper.unmount();
      trigger.remove();
    });
  });
});
