import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import SourcesModal from '@/components/SourcesModal.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';

vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');

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
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  beforeEach(() => {
    mockLibraryState = reactive({
      mediaDirectories: [],
      allAlbums: [],
      albumsSelectedForSlideshow: {},
      supportedExtensions: { images: [], videos: [] },
      globalMediaPoolForSelection: [],
      totalMediaInPool: 0,
    });

    mockPlayerState = reactive({
      currentMediaItem: null,
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      isSlideshowActive: false,
      isTimerRunning: false,
      timerDuration: 30,
      slideshowTimerId: null,
    });

    mockUIState = reactive({
      isSourcesModalVisible: true,
      mediaFilter: 'All',
    });

    (useLibraryStore as unknown as Mock).mockReturnValue(mockLibraryState);

    (usePlayerStore as unknown as Mock).mockReturnValue(mockPlayerState);

    (useUIStore as unknown as Mock).mockReturnValue(mockUIState);
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
