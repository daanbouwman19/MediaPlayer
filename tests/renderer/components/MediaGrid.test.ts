import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, toRefs, computed } from 'vue';
import MediaGrid from '@/components/MediaGrid.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

// Mock stores
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/usePlaylistStore');
vi.mock('@/composables/useUIStore');

// Mock api
vi.mock('@/api', () => ({
  api: {
    getMediaUrlGenerator: vi.fn(),
    getThumbnailUrlGenerator: vi.fn(),
  },
}));

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: any) {
    (ResizeObserverMock as any).mock.calls.push([callback]);
  }
  static mock = {
    calls: [] as any[][],
  };
}
global.ResizeObserver = ResizeObserverMock as any;

describe('MediaGrid.vue', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockPlaylistState: any;
  let mockUIState: any;

  beforeEach(() => {
    mockLibraryState = reactive({
      imageExtensionsSet: new Set(['.jpg', '.png']),
      videoExtensionsSet: new Set(['.mp4', '.webm']),
      supportedExtensions: {
        images: ['.jpg', '.png'],
        videos: ['.mp4', '.webm'],
      },
      mediaUrlGenerator: (path: string) =>
        `http://localhost:1234/${encodeURIComponent(path)}`,
      thumbnailUrlGenerator: (path: string) =>
        `http://localhost:1234/thumb/${encodeURIComponent(path)}`,
      gridMediaFiles: [],
    });

    mockPlayerState = reactive({
      isSlideshowActive: false,
      isTimerRunning: false,
    });

    mockPlaylistState = reactive({
      history: [],
      queue: [],
      currentItem: null,
    });

    mockUIState = reactive({
      viewMode: 'grid',
      gridMediaFiles: [],
    });

    vi.clearAllMocks();
    (ResizeObserverMock as any).mock.calls = [];

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      ...toRefs(mockLibraryState),
    });

    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      ...toRefs(mockPlayerState),
    });

    const playlistStateRefs = toRefs(mockPlaylistState);
    (usePlaylistStore as Mock).mockReturnValue({
      state: mockPlaylistState,
      currentItem: playlistStateRefs.currentItem,
      hasPrevious: computed(() => mockPlaylistState.history.length > 0),
      hasNext: computed(() => mockPlaylistState.queue.length > 0),
      setQueue: vi.fn(),
      playNext: vi.fn(),
    });

    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
      ...toRefs(mockUIState),
    });

    (api.getMediaUrlGenerator as Mock).mockResolvedValue(
      (path: string) => `http://localhost:1234/${encodeURIComponent(path)}`,
    );
    (api.getThumbnailUrlGenerator as Mock).mockResolvedValue(
      (path: string) =>
        `http://localhost:1234/thumb/${encodeURIComponent(path)}`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountGrid = () =>
    mount(MediaGrid, {
      global: {
        stubs: {
          VirtualScroller: false, // Ensure we test integration
        },
      },
    });

  it('renders "No media files found" when gridMediaFiles is empty', () => {
    const wrapper = mountGrid();
    const emptyState = wrapper.find('[role="status"]');
    expect(emptyState.exists()).toBe(true);
    expect(wrapper.text()).toContain('No media files found');
  });

  it('renders grid items when gridMediaFiles has items', async () => {
    mockUIState.gridMediaFiles = [
      { path: '/path/to/image1.jpg', name: 'image1.jpg' },
      { path: '/path/to/video1.mp4', name: 'video1.mp4' },
    ];

    const wrapper = mountGrid();
    await flushPromises();

    for (const call of (ResizeObserverMock as any).mock.calls) {
      call[0]([{ contentRect: { width: 1000, height: 800 } }]);
    }

    await flushPromises();
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('.grid-item');
    expect(items).toHaveLength(2);
  });

  it('handles item click correctly', async () => {
    const item1 = { path: '/path/to/image1.jpg', name: 'image1.jpg' };
    mockUIState.gridMediaFiles = [item1];

    const wrapper = mountGrid();
    await flushPromises();

    for (const call of (ResizeObserverMock as any).mock.calls) {
      call[0]([{ contentRect: { width: 1000, height: 800 } }]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const item = wrapper.find('.grid-item');
    await item.trigger('click');

    const { setQueue, playNext } = usePlaylistStore();
    expect(setQueue).toHaveBeenCalled();
    expect(playNext).toHaveBeenCalledWith(expect.objectContaining(item1));
    expect(mockUIState.viewMode).toBe('player');
    expect(mockPlayerState.isSlideshowActive).toBe(true);
  });
});
