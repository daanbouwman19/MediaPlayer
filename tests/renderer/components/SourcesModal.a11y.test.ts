import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import SourcesModal from '@/components/SourcesModal.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';

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

describe('SourcesModal A11y', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    useLibraryStore().mediaDirectories = [];
    useLibraryStore().allAlbums = [];
    useLibraryStore().albumsSelectedForSlideshow = {};
    useLibraryStore().supportedExtensions = { images: [], videos: [], all: [] };
    useLibraryStore().globalMediaPoolForSelection = [];
    useLibraryStore().totalMediaInPool = 0;

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().isTimerRunning = false;
    usePlayerStore().timerDuration = 30;
    usePlayerStore().slideshowTimerId = null;

    useUIStore().isSourcesModalVisible = true;
    useUIStore().mediaFilter = 'All';
  });

  it('Google Drive Auth inputs should have accessible labels', async () => {
    const wrapper = mount(SourcesModal);

    // Trigger Google Drive Auth view
    (wrapper.vm as any).showDriveAuth = true;
    (wrapper.vm as any).driveAuthUrl = 'http://auth-url';
    await flushPromises();

    // Check Auth Code Input
    const authCodeInput = wrapper.find(
      'input[placeholder="Paste authorization code here"]',
    );
    expect(authCodeInput.exists()).toBe(true);

    // Check if it has an id
    const authCodeId = authCodeInput.attributes('id');
    expect(authCodeId).toBeDefined();

    // Check if there is a label for it
    const authLabel = wrapper.find(`label[for="${authCodeId}"]`);
    expect(authLabel.exists()).toBe(true);

    // Simulate Auth Success to check Folder ID input
    (wrapper.vm as any).authSuccess = true;
    await flushPromises();

    const folderIdInput = wrapper.find('input[id="drive-folder-id"]');
    expect(folderIdInput.exists()).toBe(true);

    const folderId = folderIdInput.attributes('id');
    expect(folderId).toBeDefined();

    const folderLabel = wrapper.find(`label[for="${folderId}"]`);
    expect(folderLabel.exists()).toBe(true);
  });
});
