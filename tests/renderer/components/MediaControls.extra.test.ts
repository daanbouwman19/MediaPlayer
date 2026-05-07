import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { mount } from '@vue/test-utils';
import MediaControls from '@/components/MediaControls.vue';
import { api } from '@/api';
import { useUIStore } from '@/composables/useUIStore';

// Mock API
vi.mock('@/api', () => ({
  api: {
    getHeatmap: vi.fn(),
    getHeatmapProgress: vi.fn(),
    getMetadata: vi.fn(),
  },
}));

vi.mock('@/composables/useUIStore', () => ({
  useUIStore: vi.fn(),
}));

describe('MediaControls Extra Coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (useUIStore as unknown as Mock).mockReturnValue({
      isSidebarVisible: { value: true },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches heatmap data after debounce', async () => {
    mount(MediaControls, {
      props: {
        currentMediaItem: { path: 'video.mp4', name: 'video.mp4' } as any,
        isPlaying: false,
        canNavigate: true,
        isControlsVisible: true,
        isImage: false,
      },
      global: {
        stubs: {
          ProgressBar: { template: '<div></div>' },
          TranscodingStatus: true,
        },
      },
    });

    (api.getHeatmap as any).mockResolvedValue({ points: 100 });
    (api.getMetadata as any).mockResolvedValue({});

    vi.advanceTimersByTime(1000);

    await vi.waitFor(() => {
      expect(api.getHeatmap).toHaveBeenCalledWith('video.mp4', 100);
    });
  });

  it('polls for heatmap progress', async () => {
    mount(MediaControls, {
      props: {
        currentMediaItem: { path: 'heavy.mp4', name: 'heavy.mp4' } as any,
        isPlaying: false,
        canNavigate: true,
        isControlsVisible: true,
        isImage: false,
      },
    });

    vi.advanceTimersByTime(1000);
    (api.getHeatmapProgress as any).mockResolvedValue(50);
    vi.advanceTimersByTime(2000);

    expect(api.getHeatmapProgress).toHaveBeenCalledWith('heavy.mp4');
  });

  it('handles resize observer updates', async () => {
    const wrapper = mount(MediaControls, {
      props: {
        currentMediaItem: { path: 'video.mp4', name: 'video' } as any,
        isPlaying: false,
        canNavigate: true,
        isControlsVisible: true,
        isImage: false,
      },
    });

    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));

    expect((wrapper.vm as any).isDesktop).toBe(false);
  });
});
