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
import { reactive, toRefs } from 'vue';
import MediaGrid from '@/components/MediaGrid.vue';
import { api } from '@/api';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import VirtualScroller from '@/components/VirtualScroller.vue';

// Mock stores
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
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
      mediaDirectories: [{ path: '/test', id: 1 }],
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: 0,
      currentMediaItem: null,
      isSlideshowActive: false,
      isTimerRunning: false,
    });

    mockUIState = reactive({
      viewMode: 'grid',
      gridMediaFiles: [],
      isSidebarVisible: true,
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

  // Use the real VirtualScroller instead of stubbing, to ensure props are passed correctly
  const mountGrid = () =>
    mount(MediaGrid, {
      // We do NOT stub VirtualScroller, we test integration.
    });

  it('renders "No media files found" when gridMediaFiles is empty', () => {
    const wrapper = mountGrid();
    const emptyState = wrapper.find('[role="status"]');
    expect(emptyState.exists()).toBe(true);
    expect(emptyState.attributes('aria-live')).toBe('polite');
    expect(wrapper.text()).toContain('No media files found');
    expect(wrapper.text()).toContain('Try selecting a different album');
  });

  it('renders grid items when gridMediaFiles has items', async () => {
    mockUIState.gridMediaFiles = [
      { path: '/path/to/image1.jpg', name: 'image1.jpg' },
      { path: '/path/to/video1.mp4', name: 'video1.mp4' },
    ];

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger ResizeObserver to ensure columns are calculated
    const calls = (ResizeObserverMock as any).mock.calls;
    // We expect 2 calls: one for MediaGrid container, one for VirtualScroller container
    // We need to trigger the one for MediaGrid to set containerWidth
    // In MediaGrid.vue: setupResizeObserver observes scrollerContainer
    // In VirtualScroller.vue: observes scroller

    // We need to trigger the one that sets containerWidth.
    // Assuming the MediaGrid one is registered first or we just trigger all?
    // Let's trigger all with a large width.
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }

    await flushPromises();
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('.grid-item');
    // With 2 items and plenty of space, both should be rendered.
    expect(items).toHaveLength(2);

    // Check content of first item
    const img = items[0].find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toContain(
      encodeURIComponent('/path/to/image1.jpg'),
    );

    // Bolt Optimization: Video items now render an img (thumbnail) by default
    const videoImg = items[1].find('img');
    expect(videoImg.exists()).toBe(true);
    // It should point to the thumbnail generator output
    expect(videoImg.attributes('src')).toContain('thumb');
    expect(videoImg.attributes('src')).toContain(
      encodeURIComponent('/path/to/video1.mp4'),
    );
  });

  it('falls back to video tag when thumbnail loading fails', async () => {
    mockUIState.gridMediaFiles = [
      { path: '/path/to/video_fail.mp4', name: 'video_fail.mp4' },
    ];

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const items = wrapper.findAll('.grid-item');
    expect(items).toHaveLength(1);

    // Initially should be img
    const img = items[0].find('img');
    expect(img.exists()).toBe(true);
    expect(items[0].find('video').exists()).toBe(false);

    // Simulate error
    await img.trigger('error');

    // Now should be video
    expect(items[0].find('img').exists()).toBe(false);
    expect(items[0].find('video').exists()).toBe(true);
    expect(items[0].find('video').attributes('src')).toContain(
      encodeURIComponent('/path/to/video_fail.mp4'),
    );
  });

  it('handles item click correctly', async () => {
    const item1 = { path: '/path/to/image1.jpg', name: 'image1.jpg' };
    mockUIState.gridMediaFiles = [item1];

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger resize to render items
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const item = wrapper.find('.grid-item');
    await item.trigger('click');

    expect(mockUIState.viewMode).toBe('player');
    expect(mockPlayerState.isSlideshowActive).toBe(true);
    expect(mockPlayerState.currentMediaIndex).toBe(0);
    expect(mockPlayerState.currentMediaItem).toEqual(
      expect.objectContaining(item1),
    );
  });

  it('passes correct index when clicking item in second row', async () => {
    const items = [
      { path: '0.jpg', name: '0.jpg' },
      { path: '1.jpg', name: '1.jpg' },
      { path: '2.jpg', name: '2.jpg' },
      { path: '3.jpg', name: '3.jpg' },
    ];
    mockUIState.gridMediaFiles = items;

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger ResizeObserver (3 cols)
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const gridItems = wrapper.findAll('.grid-item');
    // We expect 4 items rendered
    expect(gridItems).toHaveLength(4);

    await gridItems[3].trigger('click');

    expect(mockPlayerState.currentMediaIndex).toBe(3);
    expect(mockPlayerState.currentMediaItem.path).toBe('3.jpg');
  });

  it('closes grid view when Close button is clicked', async () => {
    const wrapper = mountGrid();

    const closeButton = wrapper.find('button[title="Close Grid View"]');
    await closeButton.trigger('click');

    expect(mockUIState.viewMode).toBe('player');
  });

  it('passes all items to scroller (virtual scrolling)', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      path: `/path/item${i}.jpg`,
      name: `item${i}.jpg`,
    }));
    mockUIState.gridMediaFiles = items;

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger resize (5 columns)
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1400, height: 800 },
          contentBoxSize: [{ inlineSize: 1400 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const scroller = wrapper.findComponent(VirtualScroller);
    expect(scroller.exists()).toBe(true);
    const passedItems = scroller.props('items');
    // 30 items / 5 cols = 6 rows
    expect(passedItems).toHaveLength(6);
  });

  it('generates correct URLs for encoded paths', async () => {
    mockUIState.gridMediaFiles = [
      { path: '/path/with spaces/image.jpg', name: 'image.jpg' },
    ];

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    expect(img.attributes('src')).toContain('with%20spaces');
  });

  it('handles files with no extension', async () => {
    mockUIState.gridMediaFiles = [
      { path: '/path/noextension', name: 'noextension' },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('video').exists()).toBe(false);
  });

  it('handles tricky paths correctly (dots in dirs, dotfiles)', async () => {
    mockUIState.gridMediaFiles = [
      { path: '/path.to/file', name: 'file' },
      { path: '/path/.config', name: '.config' },
      { path: '/path/image.jpg', name: 'image.jpg' },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Should render all grid items (placeholders), but only one image content
    expect(wrapper.findAll('.grid-item')).toHaveLength(3);
    expect(wrapper.findAll('img')).toHaveLength(1);
    const img = wrapper.find('img');
    expect(img.attributes('src')).toContain('image.jpg');
  });
});
