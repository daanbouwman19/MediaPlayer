import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
} from 'vitest';

import { reactive, computed } from 'vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';

// Mock the composables
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');

// Mock the api module
vi.mock('@/api', () => ({
  api: {
    recordMediaView: vi.fn(),
  },
}));

// Minimalist mock for window.electronAPI
global.window.electronAPI = {
  getMediaUrl: vi.fn(),
  getThumbnailUrl: vi.fn(),
} as any;

describe('useSlideshow - setBatchAlbumSelection', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLibraryState = reactive({
      albumsSelectedForSlideshow: {},
      supportedExtensions: { images: [], videos: [] },
      globalMediaPoolForSelection: [],
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      isSlideshowActive: false,
    });

    mockUIState = reactive({
      mediaFilter: 'All',
      isHistoryMode: false,
    });

    const imageExtensionsSet = computed(() => new Set(['.png', '.jpg']));
    const videoExtensionsSet = computed(() => new Set(['.mp4']));

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      imageExtensionsSet,
      videoExtensionsSet,
    });
    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      stopSlideshow: vi.fn(),
    });
    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
    });
  });

  it('should update selection in-place for small batches (<= 50)', () => {
    const { setBatchAlbumSelection } = useSlideshow();
    const ids = ['1', '2', '3'];

    // Initial state
    mockLibraryState.albumsSelectedForSlideshow = { '1': false, '2': false, '3': false };
    const originalRef = mockLibraryState.albumsSelectedForSlideshow;

    setBatchAlbumSelection(ids, true);

    expect(mockLibraryState.albumsSelectedForSlideshow['1']).toBe(true);
    expect(mockLibraryState.albumsSelectedForSlideshow['2']).toBe(true);
    expect(mockLibraryState.albumsSelectedForSlideshow['3']).toBe(true);

    // Confirm in-place update (reference should be the same)
    expect(mockLibraryState.albumsSelectedForSlideshow).toBe(originalRef);
  });

  it('should replace the selection object for large batches (> 50)', () => {
    const { setBatchAlbumSelection } = useSlideshow();
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);

    // Initial state
    mockLibraryState.albumsSelectedForSlideshow = { 'existing': true };
    const originalRef = mockLibraryState.albumsSelectedForSlideshow;

    setBatchAlbumSelection(ids, true);

    expect(mockLibraryState.albumsSelectedForSlideshow['id-0']).toBe(true);
    expect(mockLibraryState.albumsSelectedForSlideshow['id-50']).toBe(true);
    expect(mockLibraryState.albumsSelectedForSlideshow['existing']).toBe(true); // Should preserve existing keys

    // Confirm object replacement (reference should change)
    expect(mockLibraryState.albumsSelectedForSlideshow).not.toBe(originalRef);
  });

  it('should handle deselection correctly in batch', () => {
    const { setBatchAlbumSelection } = useSlideshow();
    const ids = ['1', '2'];

    mockLibraryState.albumsSelectedForSlideshow = { '1': true, '2': true, '3': true };

    setBatchAlbumSelection(ids, false);

    expect(mockLibraryState.albumsSelectedForSlideshow['1']).toBe(false);
    expect(mockLibraryState.albumsSelectedForSlideshow['2']).toBe(false);
    expect(mockLibraryState.albumsSelectedForSlideshow['3']).toBe(true); // Untouched
  });
});
