import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { mount, VueWrapper } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaControls from '@/features/player/MediaControls.vue';
import { api } from '@/api';
import { HEATMAP_BUSY_MESSAGE } from '../../../src/core/media/analysis/heatmap-errors';

vi.mock('@/api', () => ({
  api: {
    getHeatmapProgress: vi.fn(),
    getHeatmap: vi.fn(),
    getMetadata: vi.fn(),
  },
}));

// Exposes the heatmap the controls hand to the progress bar.
vi.mock('@/components/atoms/ProgressBar.vue', () => ({
  default: {
    props: ['currentTime', 'duration', 'heatmap', 'watchedSegments'],
    template:
      '<div class="progress-bar-mock" :data-heatmap="heatmap ? heatmap.motion.join(\',\') : \'none\'"></div>',
  },
}));

const heatmapFor = (value: number) => ({
  audio: [-90],
  motion: [value],
  points: 1,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const item = (name: string) => ({ name, path: `/media/${name}` });

describe('MediaControls heatmap loading', () => {
  let wrapper: VueWrapper | null = null;

  const mountControls = (props: Record<string, unknown> = {}) => {
    wrapper = mount(MediaControls, {
      props: {
        currentMediaItem: item('a.mp4'),
        isPlaying: true,
        canNavigate: true,
        isControlsVisible: true,
        isImage: false,
        ...props,
      },
    });
    return wrapper;
  };
  const shownHeatmap = () =>
    wrapper!.find('.progress-bar-mock').attributes('data-heatmap');
  const indicator = () => wrapper!.find('[role="status"]');

  beforeAll(() => {
    global.ResizeObserver = class {
      observe = vi.fn();
      disconnect = vi.fn();
      unobserve = vi.fn();
    } as any;
  });

  afterAll(() => {
    delete (global as any).ResizeObserver;
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    vi.mocked(api.getMetadata).mockResolvedValue({});
    vi.mocked(api.getHeatmapProgress).mockResolvedValue(null);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  it('does not analyse images', async () => {
    mountControls({ currentMediaItem: item('photo.jpg'), isImage: true });
    await vi.advanceTimersByTimeAsync(5000);

    expect(api.getHeatmap).not.toHaveBeenCalled();
    expect(api.getHeatmapProgress).not.toHaveBeenCalled();
    expect(indicator().exists()).toBe(false);
  });

  it("never shows the previous item's heatmap on the next item", async () => {
    const first = deferred<ReturnType<typeof heatmapFor>>();
    const second = deferred<ReturnType<typeof heatmapFor>>();
    vi.mocked(api.getHeatmap)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    first.resolve(heatmapFor(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(shownHeatmap()).toBe('1');

    await wrapper!.setProps({ currentMediaItem: item('b.mp4') });
    expect(shownHeatmap()).toBe('none');

    await vi.advanceTimersByTimeAsync(1000);
    second.resolve(heatmapFor(2));
    await vi.advanceTimersByTimeAsync(0);
    expect(shownHeatmap()).toBe('2');
  });

  it('ignores a late response for an item that is no longer shown', async () => {
    const stale = deferred<ReturnType<typeof heatmapFor>>();
    vi.mocked(api.getHeatmap)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(new Promise(() => {}));

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    await wrapper!.setProps({ currentMediaItem: item('b.mp4') });
    await vi.advanceTimersByTimeAsync(1000);

    stale.resolve(heatmapFor(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(shownHeatmap()).toBe('none');
    expect(indicator().text()).toContain('Analyzing Scene... 0%');
  });

  it('keeps reporting progress for every item, not just the first', async () => {
    vi.mocked(api.getHeatmap)
      .mockResolvedValueOnce(heatmapFor(1))
      .mockReturnValueOnce(new Promise(() => {}));
    vi.mocked(api.getHeatmapProgress).mockResolvedValue(40);

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    await wrapper!.setProps({ currentMediaItem: item('b.mp4') });
    await vi.advanceTimersByTimeAsync(1000 + 2000);

    expect(api.getHeatmapProgress).toHaveBeenLastCalledWith('/media/b.mp4');
    expect(indicator().text()).toContain('Analyzing Scene... 40%');

    await vi.advanceTimersByTimeAsync(2000);
    expect(
      vi
        .mocked(api.getHeatmapProgress)
        .mock.calls.filter(([p]) => p === '/media/b.mp4').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('retries while the backend is busy', async () => {
    vi.mocked(api.getHeatmap)
      .mockRejectedValueOnce(new Error(HEATMAP_BUSY_MESSAGE))
      .mockResolvedValueOnce(heatmapFor(7));

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.getHeatmap).toHaveBeenCalledTimes(1);
    expect(indicator().exists()).toBe(true);

    await vi.advanceTimersByTimeAsync(5000);
    expect(api.getHeatmap).toHaveBeenCalledTimes(2);
    expect(shownHeatmap()).toBe('7');
    expect(indicator().exists()).toBe(false);
  });

  it('rejoins the analysis after a dropped connection', async () => {
    vi.mocked(api.getHeatmap)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(heatmapFor(3));

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(api.getHeatmap).toHaveBeenCalledTimes(2);
    expect(shownHeatmap()).toBe('3');
  });

  it('gives up on a real failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(api.getHeatmap).mockRejectedValue(
      new Error('Heatmap generation failed'),
    );

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(api.getHeatmap).toHaveBeenCalledTimes(1);
    expect(indicator().exists()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[MediaControls] Failed to fetch heatmap',
      expect.any(Error),
    );
    warn.mockRestore();
  });

  it('stops retrying once the item changes', async () => {
    vi.mocked(api.getHeatmap)
      .mockRejectedValueOnce(new Error(HEATMAP_BUSY_MESSAGE))
      .mockReturnValue(new Promise(() => {}));

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    await wrapper!.setProps({
      currentMediaItem: item('photo.jpg'),
      isImage: true,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(api.getHeatmap).toHaveBeenCalledTimes(1);
  });

  it('cancels the backend request when the item changes or the controls unmount', async () => {
    vi.mocked(api.getHeatmap).mockReturnValue(new Promise(() => {}));

    mountControls();
    await vi.advanceTimersByTimeAsync(1000);
    const firstSignal = vi.mocked(api.getHeatmap).mock.calls[0]?.[2]?.signal;
    expect(firstSignal?.aborted).toBe(false);

    await wrapper!.setProps({ currentMediaItem: item('b.mp4') });
    expect(firstSignal?.aborted).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    const secondSignal = vi.mocked(api.getHeatmap).mock.calls[1]?.[2]?.signal;
    wrapper!.unmount();
    wrapper = null;
    expect(secondSignal?.aborted).toBe(true);
  });
});
