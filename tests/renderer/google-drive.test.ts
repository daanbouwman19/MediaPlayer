import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import SourcesModal from '@/features/library/SourcesModal.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

// Mock dependencies
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
  },
}));

describe('Google Drive Integration in SourcesModal', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().isScanning = false;
    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().mediaDirectories = [];

    useUIStore().isSourcesModalVisible = true;

    vi.clearAllMocks();
  });

  it('should start auth flow when "Add Google Drive" is clicked', async () => {
    (api.startGoogleDriveAuth as any).mockResolvedValue('http://auth-url');
    const wrapper = mount(SourcesModal);

    // Find "Add Google Drive" button by text
    const driveButton = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add Google Drive'));
    expect(driveButton?.exists()).toBe(true);

    await driveButton?.trigger('click');

    // Expected behavior: showDriveAuth = true
    // Look for "Add Google Drive Source" header
    const authHeader = wrapper
      .findAll('h3')
      .find((h) => h.text() === 'Add Google Drive Source');
    expect(authHeader?.exists()).toBe(true);
    expect(authHeader?.text()).toBe('Add Google Drive Source');

    const startAuthBtn = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'Start Authorization')[0];
    expect(startAuthBtn.exists()).toBe(true);

    await startAuthBtn.trigger('click');
    await flushPromises();

    expect(api.startGoogleDriveAuth).toHaveBeenCalled();
    // After start, it should show instructions to paste code
    expect(wrapper.text()).toContain('Paste the code below');
  });

  it('should submit auth code', async () => {
    // Setup state as if auth url was generated
    (api.startGoogleDriveAuth as any).mockResolvedValue('http://url');
    (api.submitGoogleDriveAuthCode as any).mockResolvedValue(true);

    const wrapper = mount(SourcesModal);
    // Trigger showDriveAuth = true
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add Google Drive'))
      ?.trigger('click');

    // Trigger start auth
    await wrapper
      .findAll('button')
      .filter((b) => b.text() === 'Start Authorization')[0]
      .trigger('click');
    await flushPromises();

    // Input code
    const input = wrapper.find('input[type="text"]');
    await input.setValue('test-code');

    const submitBtn = wrapper
      .findAll('button')
      .filter((b) => b.text().includes('Submit Code'))[0];
    await submitBtn.trigger('click');
    await flushPromises();

    expect(api.submitGoogleDriveAuthCode).toHaveBeenCalledWith('test-code');
    expect(wrapper.text()).toContain('Authentication successful!');
  });

  it('should add drive source after auth', async () => {
    // Setup state: Auth success
    (api.startGoogleDriveAuth as any).mockResolvedValue('http://url');
    (api.submitGoogleDriveAuthCode as any).mockResolvedValue(true);
    (api.addGoogleDriveSource as any).mockResolvedValue({ success: true });
    (api.getMediaDirectories as any).mockResolvedValue([
      { path: 'gdrive://123', type: 'google_drive' },
    ]);

    const wrapper = mount(SourcesModal);
    // Navigate to add source state
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('Add Google Drive'))
      ?.trigger('click');
    await wrapper
      .findAll('button')
      .filter((b) => b.text() === 'Start Authorization')[0]
      .trigger('click');
    await flushPromises();
    await wrapper.find('input[type="text"]').setValue('code');
    await wrapper
      .findAll('button')
      .filter((b) => b.text().includes('Submit Code'))[0]
      .trigger('click');
    await flushPromises();

    // Now we can add folder. Input defaults to empty/root or user types it.
    // There are multiple inputs now? The auth code input might still be in DOM if v-if/v-else logic didn't remove it or if wrapper finds all.
    // Auth success block replaces the previous block, so auth code input should be gone or replaced.
    // But let's be specific for folder input.
    const folderInput = wrapper.find('input[id="drive-folder-id"]');
    await folderInput.setValue('folder-id');

    const addBtn = wrapper
      .findAll('button')
      .filter((b) => b.text() === 'Add Folder')[0];
    await addBtn.trigger('click');
    await flushPromises();

    expect(api.addGoogleDriveSource).toHaveBeenCalledWith('folder-id');
    expect(api.getMediaDirectories).toHaveBeenCalled();
    // Modal should close (showDriveAuth becomes false), so we see the list again
    expect(wrapper.text()).toContain('Manage Media Sources');
  });
});
