import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
} from 'vite-plus/test';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { ref } from 'vue';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaGrid from '@/features/library/MediaGrid.vue';
import VirtualScroller from '@/components/atoms/VirtualScroller.vue';
import { api } from '../../../src/renderer/api/index';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { usePlaylistStore } from '../../../src/renderer/composables/usePlaylistStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { useSlideshow } from '../../../src/renderer/composables/useSlideshow';
import { useTranscodeQueue } from '../../../src/renderer/composables/useTranscodeQueue';

vi.mock('../../../src/renderer/composables/useTranscodeQueue');
vi.mock('../../../src/renderer/api/index');

class ResizeObserverMock {
  static callbacks: ResizeObserverCallback[] = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  constructor(callback: ResizeObserverCallback) {
    ResizeObserverMock.callbacks.push(callback);
  }
}
global.ResizeObserver = ResizeObserverMock as any;

const files = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i}.jpg`,
    path: `/${prefix}/${prefix}${i}.jpg`,
  }));

const mountGrid = async () => {
  const wrapper = mount(MediaGrid);
  await flushPromises();
  for (const callback of ResizeObserverMock.callbacks) {
    callback(
      [{ contentRect: { width: 1000, height: 800 } }] as any,
      {} as ResizeObserver,
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  await flushPromises();
  return wrapper;
};

const gridItems = (wrapper: VueWrapper) => wrapper.findAll('.grid-item');

describe('MediaGrid.vue playback session and list changes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    ResizeObserverMock.callbacks = [];
    setActivePinia(
      createTestingPinia({ stubActions: false, createSpy: vi.fn }),
    );

    useLibraryStore().supportedExtensions = {
      images: ['.jpg'],
      videos: ['.mp4'],
      all: ['.jpg', '.mp4'],
    };
    useLibraryStore().mediaUrlGenerator = (path: string) => `url://${path}`;
    useLibraryStore().thumbnailUrlGenerator = (path: string) =>
      `thumb://${path}`;
    useUIStore().viewMode = 'grid';

    (useTranscodeQueue as Mock).mockReturnValue({
      jobStatusMap: ref(new Map()),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      addJobs: vi.fn().mockResolvedValue(undefined),
      cancelJob: vi.fn().mockResolvedValue(undefined),
    });
    (api.recordMediaView as Mock).mockResolvedValue(undefined);
  });

  it('F152: clears the selection, anchor and scroll position when another list is loaded', async () => {
    useUIStore().gridMediaFiles = files('a', 30);
    const wrapper = await mountGrid();

    await gridItems(wrapper)[0]!.trigger('click', { ctrlKey: true });
    expect(wrapper.text()).toContain('1 selected');
    const scrollerBefore = wrapper.findComponent(VirtualScroller).element;
    scrollerBefore.scrollTop = 600;

    useUIStore().gridMediaFiles = files('b', 30);
    await flushPromises();

    expect(wrapper.text()).not.toContain('selected');
    const scrollerAfter = wrapper.findComponent(VirtualScroller).element;
    expect(scrollerAfter).not.toBe(scrollerBefore);
    expect(scrollerAfter.scrollTop).toBe(0);

    // The old shift-click anchor is gone: a shift-click now plays the item
    // instead of selecting a range that started in the previous list.
    await gridItems(wrapper)[2]!.trigger('click', { shiftKey: true });
    await flushPromises();
    expect(wrapper.text()).not.toContain('selected');
    expect(usePlaylistStore().currentItem?.path).toBe('/b/b2.jpg');
  });

  it('F62: a plain click records a view and keeps playback within the list', async () => {
    // Left over from an earlier slideshow.
    useLibraryStore().globalMediaPoolForSelection = files('old', 3);
    useUIStore().gridMediaFiles = files('a', 3);
    const wrapper = await mountGrid();

    await gridItems(wrapper)[1]!.trigger('click');
    await flushPromises();

    const playlist = usePlaylistStore();
    expect(playlist.currentItem?.path).toBe('/a/a1.jpg');
    expect(playlist.queue.map((f) => f.path)).toEqual(['/a/a2.jpg']);
    expect(api.recordMediaView).toHaveBeenCalledWith('/a/a1.jpg');
    expect(
      useLibraryStore().globalMediaPoolForSelection.map((f) => f.path),
    ).toEqual(['/a/a0.jpg', '/a/a1.jpg', '/a/a2.jpg']);
    expect(useUIStore().viewMode).toBe('player');
    expect(usePlayerStore().isSlideshowActive).toBe(true);
    expect(usePlayerStore().isTimerRunning).toBe(false);
  });

  it('F51: a clicked video is not skipped by the previous countdown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // A slideshow is running (hidden behind the grid) with a pending timeout.
      useLibraryStore().globalMediaPoolForSelection = files('old', 3);
      usePlayerStore().isSlideshowActive = true;
      useSlideshow().resumeSlideshowTimer();
      useUIStore().gridMediaFiles = [{ name: 'v.mp4', path: '/v.mp4' }];
      const wrapper = await mountGrid();

      await gridItems(wrapper)[0]!.trigger('click');
      await vi.advanceTimersByTimeAsync(6000);

      expect(usePlaylistStore().currentItem?.path).toBe('/v.mp4');
      expect(usePlayerStore().isTimerRunning).toBe(false);
      expect(usePlayerStore().slideshowTimerId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
