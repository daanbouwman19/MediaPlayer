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
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';

import MediaGrid from '@/components/MediaGrid.vue';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

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
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    vi.clearAllMocks();
    (ResizeObserverMock as any).mock.calls = [];

    // Set Pinia store state
    useLibraryStore().supportedExtensions = {
      images: ['.jpg', '.png'],
      videos: ['.mp4', '.webm'],
      all: ['.jpg', '.png', '.mp4', '.webm'],
    };
    useLibraryStore().mediaUrlGenerator = ((path: string) =>
      `http://localhost:1234/${encodeURIComponent(path)}`) as any;
    useLibraryStore().thumbnailUrlGenerator = ((path: string) =>
      `http://localhost:1234/thumb/${encodeURIComponent(path)}`) as any;

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().isTimerRunning = false;

    usePlaylistStore().history = [];
    usePlaylistStore().queue = [];
    usePlaylistStore().currentItem = null;

    useUIStore().viewMode = 'grid';
    useUIStore().gridMediaFiles = [];

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
    useUIStore().gridMediaFiles = [
      { path: '/path/to/image1.jpg', name: 'image1.jpg' },
      { path: '/path/to/video1.mp4', name: 'video1.mp4' },
    ] as any;

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
    useUIStore().gridMediaFiles = [item1] as any;

    const wrapper = mountGrid();
    await flushPromises();

    for (const call of (ResizeObserverMock as any).mock.calls) {
      call[0]([{ contentRect: { width: 1000, height: 800 } }]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const item = wrapper.find('.grid-item');
    await item.trigger('click');

    const playlistStore = usePlaylistStore();
    expect(playlistStore.setQueue).toHaveBeenCalled();
    expect(playlistStore.playNext).toHaveBeenCalledWith(
      expect.objectContaining(item1),
    );
    expect(useUIStore().viewMode).toBe('player');
    expect(usePlayerStore().isSlideshowActive).toBe(true);
  });
});
