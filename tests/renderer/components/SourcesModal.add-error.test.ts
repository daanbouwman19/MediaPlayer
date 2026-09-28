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
import { useUIStore } from '@/composables/useUIStore';
import { useToast } from '@/composables/useToast';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    addMediaDirectory: vi.fn(),
    getMediaDirectories: vi.fn(),
    checkGoogleDriveAuth: vi.fn(),
    listDirectory: vi.fn().mockResolvedValue([]),
    getParentDirectory: vi.fn().mockResolvedValue(''),
  },
}));

describe('SourcesModal: rejected folders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(
      createTestingPinia({ stubActions: false, createSpy: vi.fn }),
    );
    useUIStore().isSourcesModalVisible = true;
    useToast().toasts.value = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('tells the user why a folder could not be added', async () => {
    (api.addMediaDirectory as Mock).mockRejectedValue(
      new Error('Access restricted for sensitive system directories'),
    );

    const wrapper = mount(SourcesModal);
    await (wrapper.vm as any).handleFileExplorerSelect('C:\\Windows');
    await flushPromises();

    expect(useToast().toasts.value).toEqual([
      expect.objectContaining({
        type: 'error',
        message:
          'Could not add folder: Access restricted for sensitive system directories',
      }),
    ]);
    expect(api.getMediaDirectories).not.toHaveBeenCalled();
  });

  it('falls back to a generic message for non-Error rejections', async () => {
    (api.addMediaDirectory as Mock).mockRejectedValue('nope');

    const wrapper = mount(SourcesModal);
    await (wrapper.vm as any).handleFileExplorerSelect('/somewhere');
    await flushPromises();

    expect(useToast().toasts.value).toEqual([
      expect.objectContaining({
        type: 'error',
        message: 'Could not add folder.',
      }),
    ]);
  });
});
