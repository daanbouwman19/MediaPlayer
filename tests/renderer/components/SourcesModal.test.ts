import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import SourcesModal from '@/components/SourcesModal.vue';

import { useLibraryStore } from '@/composables/useLibraryStore';
import { useUIStore } from '@/composables/useUIStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { api } from '@/api';

// Mock the composables
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/useUIStore');
vi.mock('@/composables/usePlayerStore');

// Mock the API module
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
  let mockLibraryState: any;
  let mockUIState: any;
  let mockPlayerState: any;

  beforeEach(() => {
    mockLibraryState = reactive({
      isScanning: false,
      allAlbums: [],
      mediaDirectories: [
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
      ],
      albumsSelectedForSlideshow: {},
      globalMediaPoolForSelection: [],
    });

    mockUIState = reactive({
      isSourcesModalVisible: true,
    });

    mockPlayerState = reactive({
      isSlideshowActive: false,
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      currentMediaItem: null,
    });

    (useLibraryStore as unknown as Mock).mockReturnValue(mockLibraryState);
    (useUIStore as unknown as Mock).mockReturnValue(mockUIState);
    (usePlayerStore as unknown as Mock).mockReturnValue(mockPlayerState);

    vi.clearAllMocks();

    (api.addMediaDirectory as Mock).mockResolvedValue('/default/path');
    (api.removeMediaDirectory as Mock).mockResolvedValue(undefined);
    (api.setDirectoryActiveState as Mock).mockResolvedValue(undefined);
    (api.getMediaDirectories as Mock).mockResolvedValue([]);
    (api.reindexMediaLibrary as Mock).mockResolvedValue([]);
    (api.checkGoogleDriveAuth as Mock).mockResolvedValue(true);
  });

  it('should render modal when visible', () => {
    const wrapper = mount(SourcesModal);
    // Finds the outer fixed overlay div
    expect(wrapper.find('.fixed.inset-0').exists()).toBe(true);
    expect(wrapper.text()).toContain('Manage Media Sources');
  });

  it('should not render when not visible', () => {
    mockUIState.isSourcesModalVisible = false;
    const wrapper = mount(SourcesModal);
    expect(wrapper.find('.fixed.inset-0').exists()).toBe(false);
  });

  it('should display media directories', () => {
    const wrapper = mount(SourcesModal);
    expect(wrapper.text()).toContain('/path/to/dir1');
    expect(wrapper.text()).toContain('/path/to/dir2');
  });

  it('should show empty message when no directories', () => {
    mockLibraryState.mediaDirectories = [];
    const wrapper = mount(SourcesModal);
    expect(wrapper.text()).toContain('No media sources configured yet');
  });

  it('shows warning when Google Drive is disconnected on mount', async () => {
    mockLibraryState.mediaDirectories.push({
      path: 'gdrive://123',
      isActive: true,
      id: '3',
      name: 'Drive',
      type: 'google_drive',
    });
    (api.checkGoogleDriveAuth as Mock).mockResolvedValue(false);

    const wrapper = mount(SourcesModal);
    await flushPromises();

    expect(api.checkGoogleDriveAuth).toHaveBeenCalled();
    expect(wrapper.text()).toContain('Google Drive Disconnected');

    // Test the re-authenticate button
    const reauthBtn = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Re-authenticate Drive');
    await reauthBtn?.trigger('click');
    expect((wrapper.vm as any).showDriveAuth).toBe(true);
  });

  it('should close modal when close button clicked', async () => {
    const wrapper = mount(SourcesModal);
    const closeButton = wrapper.find('button[aria-label="Close"]');
    await closeButton.trigger('click');
    expect(mockUIState.isSourcesModalVisible).toBe(false);
  });

  it('should close modal when clicking overlay', async () => {
    const wrapper = mount(SourcesModal);
    // Check for the first fixed overlay (main modal)
    await wrapper.find('.fixed.inset-0').trigger('click.self');
    expect(mockUIState.isSourcesModalVisible).toBe(false);
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
    // Find the REMOVE button for the first item
    const removeButtons = wrapper.findAll('button');
    const removeBtn = removeButtons.find((b) => b.text().includes('REMOVE'));
    await removeBtn?.trigger('click');

    // Now find CONFIRM button
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
    // Should revert to showing REMOVE button
    expect(
      wrapper.findAll('button').find((b) => b.text().includes('REMOVE')),
    ).toBeTruthy();
  });

  it('should open FileExplorer when add button clicked', async () => {
    const wrapper = mount(SourcesModal);
    const buttons = wrapper.findAll('button');
    const addButton = buttons.find((b) =>
      b.text().includes('Add Local Folder'),
    );
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
    expect(mockLibraryState.mediaDirectories).toContainEqual({
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
    const buttons = wrapper.findAll('button');
    const reindexButton = buttons.find((b) =>
      b.text().includes('APPLY CHANGES & RE-INDEX'),
    );
    expect(reindexButton?.exists()).toBe(true);

    await reindexButton?.trigger('click');
    await flushPromises();

    expect(api.reindexMediaLibrary).toHaveBeenCalled();
    expect(mockLibraryState.albumsSelectedForSlideshow).toEqual({
      'newAlbum1-id': true,
      'newAlbum2-id': true,
      'subAlbum-id': true,
    });
  });

  it('should handle error when reindexing fails', async () => {
    const error = new Error('Reindex failed');
    (api.reindexMediaLibrary as Mock).mockRejectedValue(error);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(SourcesModal);
    const buttons = wrapper.findAll('button');
    const reindexButton = buttons.find((b) =>
      b.text().includes('APPLY CHANGES & RE-INDEX'),
    );

    await reindexButton?.trigger('click');
    await flushPromises();

    expect(api.reindexMediaLibrary).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Error re-indexing library:',
      error,
    );
    // isScanning is set to false in finally
    expect(mockLibraryState.isScanning).toBe(false);
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
    consoleSpy.mockRestore();
  });

  it('should handle directory not found during toggle', async () => {
    const wrapper = mount(SourcesModal);
    await (wrapper.vm as any).handleToggleActive('/non-existent/path', true);
    expect(mockLibraryState.mediaDirectories[0].isActive).toBe(true);
    expect(mockLibraryState.mediaDirectories[1].isActive).toBe(false);
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
    consoleSpy.mockRestore();
  });

  it('should handle directory not found during remove', async () => {
    const wrapper = mount(SourcesModal);
    // Directly calling internal method for this test case or mimicking UI
    await (wrapper.vm as any).confirmRemove('/non-existent/path');
    expect(mockLibraryState.mediaDirectories).toHaveLength(2);
  });

  describe('Google Drive Auth', () => {
    it('starts drive auth flow', async () => {
      (api.startGoogleDriveAuth as Mock).mockResolvedValue('http://auth-url');
      const wrapper = mount(SourcesModal);

      // Find "Add Google Drive" button (it's inside the grid now)
      const buttons = wrapper.findAll('button');
      const addDriveBtn = buttons.find((b) =>
        b.text().includes('Add Google Drive'),
      );
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

      // Find by ID directly from template
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
});
