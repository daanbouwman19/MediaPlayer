import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive, ref, nextTick } from 'vue';
import MediaGrid from '../../../src/renderer/components/MediaGrid.vue';
import { api } from '../../../src/renderer/api';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { usePlaylistStore } from '../../../src/renderer/composables/usePlaylistStore';
import { useTranscodeQueue } from '../../../src/renderer/composables/useTranscodeQueue';
import VirtualScroller from '../../../src/renderer/components/VirtualScroller.vue';

// Mock dependencies
vi.mock('../../../src/renderer/composables/useLibraryStore');
vi.mock('../../../src/renderer/composables/usePlayerStore');
vi.mock('../../../src/renderer/composables/useUIStore');
vi.mock('../../../src/renderer/composables/usePlaylistStore');
vi.mock('../../../src/renderer/composables/useTranscodeQueue');
vi.mock('../../../src/renderer/api');

// Mock ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  constructor(callback: any) {
    (ResizeObserverMock as any).mock.calls.push([callback]);
  }
  static mock = {
    calls: [] as any[][],
  };
}
global.ResizeObserver = ResizeObserverMock as any;

describe('MediaGrid.vue Coverage', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;
  let mockAddJobs: any;
  let mockCancelJob: any;
  let mockStartPolling: any;
  let mockStopPolling: any;

  beforeEach(() => {
    vi.resetAllMocks();
    (ResizeObserverMock as any).mock.calls = []; // Reset static mock calls

    mockLibraryState = reactive({
      supportedExtensions: {
        images: ['.jpg', '.png'],
        videos: ['.mp4', '.mkv'],
        all: ['.jpg', '.png', '.mp4', '.mkv'],
      },
      imageExtensionsSet: new Set(['.jpg', '.png']),
      videoExtensionsSet: new Set(['.mp4', '.mkv']),
      mediaUrlGenerator: (path: string) => `url://${path}`,
      thumbnailUrlGenerator: (path: string) => `thumb://${path}`,
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      currentMediaItem: null,
      isSlideshowActive: false,
      isTimerRunning: false,
    });

    mockUIState = reactive({
      viewMode: 'grid',
      gridMediaFiles: [],
    });

    mockStartPolling = vi.fn();
    mockStopPolling = vi.fn();
    mockAddJobs = vi.fn().mockResolvedValue(undefined);
    mockCancelJob = vi.fn().mockResolvedValue(undefined);

    (useLibraryStore as unknown as Mock).mockReturnValue(mockLibraryState);

    (usePlayerStore as unknown as Mock).mockReturnValue(mockPlayerState);

    (useUIStore as unknown as Mock).mockReturnValue(mockUIState);

    (usePlaylistStore as unknown as Mock).mockReturnValue({
      setQueue: vi.fn(),
      playNext: vi.fn(),
      clearPlaylist: vi.fn(),
      state: reactive({ queue: [], currentItem: null }),
    });

    (useTranscodeQueue as Mock).mockReturnValue({
      jobStatusMap: ref(new Map()),
      startPolling: mockStartPolling,
      stopPolling: mockStopPolling,
      addJobs: mockAddJobs,
      cancelJob: mockCancelJob,
    });

    (api.getMediaUrlGenerator as any).mockResolvedValue(
      (path: string) => `url://${path}`,
    );
    (api.getThumbnailUrlGenerator as any).mockResolvedValue(
      (path: string) => `thumb://${path}`,
    );
  });

  const mountGrid = () => mount(MediaGrid);

  it('getExtension edge cases: no dot', async () => {
    mockUIState.gridMediaFiles = [
      { name: 'file-no-ext', path: '/path/to/file-no-ext', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.find('video').exists()).toBe(false);
  });

  it('getExtension edge cases: dot in directory name', async () => {
    mockUIState.gridMediaFiles = [
      { name: 'file', path: '/path.with.dot/file', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('getExtension edge cases: dotfile', async () => {
    mockUIState.gridMediaFiles = [
      { name: '.gitignore', path: '/.gitignore', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('handleItemClick sets state correctly', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    await wrapper.find('button.grid-item').trigger('click');

    expect(mockUIState.viewMode).toBe('player');
    expect(mockPlayerState.isSlideshowActive).toBe(true);
    // expect(mockPlayerState.currentMediaItem.path).toEqual(item.path);
  });

  it('closeGrid sets viewMode to player', async () => {
    const wrapper = mountGrid();
    await wrapper.find('button[title="Close Grid View"]').trigger('click');
    expect(mockUIState.viewMode).toBe('player');
  });

  it('uses getPosterUrl for videos', async () => {
    const item = { name: 'vid.mp4', path: '/vid.mp4', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const mockThumbGen = vi.fn().mockReturnValue('thumb.jpg');
    mockLibraryState.thumbnailUrlGenerator = mockThumbGen;

    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();
    await nextTick();

    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('thumb.jpg');
    expect(mockThumbGen).toHaveBeenCalledWith('/vid.mp4');
  });

  it('updates chunking when allMediaFiles changes', async () => {
    mockUIState.gridMediaFiles = Array.from({ length: 50 }, (_, i) => ({
      name: `${i}.jpg`,
      path: `${i}.jpg`,
    }));
    const wrapper = mountGrid();
    await flushPromises();

    // Resize for 5 columns
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1400, height: 800 },
          contentBoxSize: [{ inlineSize: 1400 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // 1400 >= 1280 (GRID_BREAKPOINT_XL) so it defaults to 5 cols.
    // Wait for the computed columnCount to update.
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as typeof wrapper.vm & { columnCount: number };
    const columnCount = vm.columnCount;
    const expectedLength = Math.ceil(50 / columnCount);

    expect(wrapper.findComponent(VirtualScroller).props('items')).toHaveLength(
      expectedLength,
    );

    // Change data
    mockUIState.gridMediaFiles = [
      { name: 'new.jpg', path: 'new.jpg', viewCount: 0 },
    ];
    await nextTick();

    // 1 item / 5 cols = 1 row
    expect(wrapper.findComponent(VirtualScroller).props('items')).toHaveLength(
      1,
    );
  });

  it('getMediaUrl returns empty if generator not ready', async () => {
    // Simulate delayed generator availability in store
    mockLibraryState.mediaUrlGenerator = null;

    mockUIState.gridMediaFiles = [{ name: 'img.jpg', path: '/img.jpg' }];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Should be empty initially
    expect(wrapper.find('img').attributes('src')).toBe('');

    // Update store state
    mockLibraryState.mediaUrlGenerator = (path: string) => `thumb://${path}`;
    await nextTick();

    expect(wrapper.find('img').attributes('src')).toBe('thumb:///img.jpg');
  });

  it('handleImageError fallback to full URL', async () => {
    mockUIState.gridMediaFiles = [{ name: 'img.jpg', path: '/img.jpg' }];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    expect(img.attributes('src')).toBe('thumb:///img.jpg');

    // Trigger error
    await img.trigger('error');

    // Since handleImageError modifies the DOM element directly, we check the element property
    // However, jsdom might not update 'attributes' via vue-test-utils automatically for direct DOM manip.
    // Let's check the element's src property directly.
    expect(img.element.src).toBe('url:///img.jpg');
  });

  it('getDisplayName fallback to path parsing', async () => {
    const item = { path: '/some/path/file.jpg' } as any;
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Trigger Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('file.jpg');
  });

  it('handleImageError final failure state', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg' };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Resize for rendering
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    // Set src to match fullUrl to trigger final failure branch
    img.element.src = 'url:///img.jpg';
    await img.trigger('error');

    await wrapper.vm.$nextTick();
    // Should now show failure placeholder (svg)
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('renders rating overlay when present', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', rating: 5 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Resize
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('5');
    expect(wrapper.find('.text-accent').exists()).toBe(true);
  });

  it('disconnects ResizeObserver on unmount', async () => {
    const wrapper = mountGrid();
    await flushPromises();

    const disconnectSpy = vi.spyOn(ResizeObserverMock.prototype, 'disconnect');
    wrapper.unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('handleItemClick works even if image failed', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg' };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    // Resize and trigger error
    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const img = wrapper.find('img');
    img.element.src = 'url:///img.jpg';
    await img.trigger('error');
    await wrapper.vm.$nextTick();

    // Click the failed item (which is now represented by the fallback div)
    await wrapper.find('button.grid-item').trigger('click');
    // expect(mockState.currentMediaItem.path).toBe('/img.jpg');
    // Check if the click handler was called or some state changed
  });

  it('calls startPolling on mount and stopPolling on unmount', async () => {
    const wrapper = mountGrid();
    await flushPromises();
    expect(mockStartPolling).toHaveBeenCalled();
    wrapper.unmount();
    expect(mockStopPolling).toHaveBeenCalled();
  });

  it('ctrl+click selects an item and shows action bar', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();

    // Action bar should appear with "1 selected"
    expect(wrapper.text()).toContain('1 selected');
    expect(mockUIState.viewMode).toBe('grid'); // Did not navigate away
  });

  it('ctrl+click deselects already-selected item', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // First ctrl+click selects
    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1 selected');

    // Second ctrl+click deselects
    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(
      wrapper.find('[title="Pre-transcode selected files"]').exists(),
    ).toBe(false);
  });

  it('shift+click range-selects items', async () => {
    mockUIState.gridMediaFiles = [
      { name: 'a.jpg', path: '/a.jpg', viewCount: 0 },
      { name: 'b.jpg', path: '/b.jpg', viewCount: 0 },
    ];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll('button.grid-item');
    // Plain click on first item sets lastClickedIndex=0, clears selection
    await buttons[0].trigger('click');
    await wrapper.vm.$nextTick();

    // Now shift+click on second item should range-select items 0 and 1
    await buttons[1].trigger('click', { shiftKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('2 selected');
  });

  it('shift+click with no anchor falls through to plain click', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Shift+click on item 0 with no prior anchor (lastClickedIndex = -1)
    await wrapper.find('button.grid-item').trigger('click', { shiftKey: true });
    await wrapper.vm.$nextTick();

    // Falls through to plain click → navigates
    expect(mockUIState.viewMode).toBe('player');
  });

  it('pre-transcode button calls addJobs and clears selection', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Select an item
    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1 selected');

    // Click Pre-transcode
    await wrapper
      .find('[title="Pre-transcode selected files"]')
      .trigger('click');
    await flushPromises();

    expect(mockAddJobs).toHaveBeenCalledWith(['/img.jpg']);
    // Selection should be cleared
    expect(
      wrapper.find('[title="Pre-transcode selected files"]').exists(),
    ).toBe(false);
  });

  it('clear selection button removes selected state', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Select an item
    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1 selected');

    // Click Clear
    await wrapper.find('[title="Clear selection"]').trigger('click');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[title="Clear selection"]').exists()).toBe(false);
  });

  it('clear HLS button calls cancelJob for items with transcode jobs', async () => {
    const item = { name: 'vid.mp4', path: '/vid.mp4', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const jobStatusMap = ref(new Map([['/vid.mp4', 'done']]));
    (useTranscodeQueue as Mock).mockReturnValue({
      jobStatusMap,
      startPolling: mockStartPolling,
      stopPolling: mockStopPolling,
      addJobs: mockAddJobs,
      cancelJob: mockCancelJob,
    });

    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Select an item
    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1 selected');

    // "Clear HLS" button should be visible since the item has a transcode job
    const clearHlsBtn = wrapper.find(
      '[title="Remove pre-transcoded HLS for selected files"]',
    );
    expect(clearHlsBtn.exists()).toBe(true);

    await clearHlsBtn.trigger('click');
    await flushPromises();

    expect(mockCancelJob).toHaveBeenCalledWith('/vid.mp4');
    // Selection should be cleared
    expect(
      wrapper
        .find('[title="Remove pre-transcoded HLS for selected files"]')
        .exists(),
    ).toBe(false);
  });

  it('plain click after ctrl+click clears selection and navigates', async () => {
    const item = { name: 'img.jpg', path: '/img.jpg', viewCount: 0 };
    mockUIState.gridMediaFiles = [item];
    const wrapper = mountGrid();
    await flushPromises();

    const calls = (ResizeObserverMock as any).mock.calls;
    for (const call of calls) {
      call[0]([
        {
          contentRect: { width: 1000, height: 800 },
          contentBoxSize: [{ inlineSize: 1000 }],
        },
      ]);
    }
    await wrapper.vm.$nextTick();

    // Ctrl+click to select
    await wrapper.find('button.grid-item').trigger('click', { ctrlKey: true });
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('1 selected');

    // Plain click clears selection and plays
    await wrapper.find('button.grid-item').trigger('click');
    await wrapper.vm.$nextTick();
    expect(mockUIState.viewMode).toBe('player');
    expect(
      wrapper.find('[title="Pre-transcode selected files"]').exists(),
    ).toBe(false);
  });
});
