import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import MediaGridItem from '@/features/library/MediaGridItem.vue';
import { ElectronAdapter } from '@/api/ElectronAdapter';
import { WebAdapter } from '@/api/WebAdapter';
import type { DriveCacheProgressEvent } from '../../../src/shared/ipc/media.contract';

// Mock formatDurationForA11y to return predictable strings
vi.mock('../../../src/renderer/utils/timeUtils', async () => {
  const actual = await vi.importActual('../../../src/renderer/utils/timeUtils');
  return {
    ...(actual as any),
    formatDurationForA11y: (s: number) => `${s} sec`,
  };
});

// Each Drive test installs a real adapter (Electron over a fake bridge, or
// Web), so the component is exercised through the same API it uses in the app.
const backend = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/api/index', () => ({
  get api() {
    return backend.current;
  },
}));

describe('MediaGridItem.vue', () => {
  const defaultProps = {
    imageExtensionsSet: new Set(['.jpg']),
    videoExtensionsSet: new Set(['.mp4']),
    mediaUrlGenerator: (path: string) => path,
    thumbnailUrlGenerator: (path: string) => path,
    failedImagePaths: new Set<string>(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders correct aria-label for image without rating', () => {
    const item = {
      path: 'test.jpg',
      name: 'test.jpg',
      rating: 0,
      duration: 0,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    const button = wrapper.find('button');
    expect(button.attributes('aria-label')).toBe('View test.jpg, Image');
  });

  it('renders correct aria-label for single star rating', () => {
    const item = {
      path: 'test.jpg',
      name: 'test.jpg',
      rating: 1,
      duration: 0,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    const button = wrapper.find('button');
    expect(button.attributes('aria-label')).toBe(
      'View test.jpg, Image, Rated 1 star',
    );
  });

  it('renders correct aria-label for image with rating', () => {
    const item = {
      path: 'test.jpg',
      name: 'test.jpg',
      rating: 4,
      duration: 0,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    const button = wrapper.find('button');
    expect(button.attributes('aria-label')).toBe(
      'View test.jpg, Image, Rated 4 stars',
    );
  });

  it('renders correct aria-label for video without rating', () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    const button = wrapper.find('button');
    expect(button.attributes('aria-label')).toBe(
      'View test.mp4, Video, 120 sec',
    );
  });

  it('renders correct aria-label for video with rating', () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 5,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    const button = wrapper.find('button');
    expect(button.attributes('aria-label')).toBe(
      'View test.mp4, Video, 120 sec, Rated 5 stars',
    );
  });

  it('shows video preview on hover after debounce', async () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    // Initially should show image (poster)
    expect(wrapper.find('img').exists()).toBe(true);
    expect(wrapper.find('video').exists()).toBe(false);

    // Trigger mouseenter
    await wrapper.trigger('mouseenter');

    // Should not switch immediately (debounce)
    expect(wrapper.find('video').exists()).toBe(false);

    // Fast-forward time
    await vi.advanceTimersByTimeAsync(500);

    // Now should show video
    expect(wrapper.find('video').exists()).toBe(true);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('stops video preview on mouseleave', async () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    // Enter and wait
    await wrapper.trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.find('video').exists()).toBe(true);

    // Leave
    await wrapper.trigger('mouseleave');
    // Should switch back immediately
    expect(wrapper.find('video').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('handles focus/blur for accessibility', async () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    // Focus triggers preview (via same handler as mouseenter)
    await wrapper.find('button').trigger('focus');
    expect(wrapper.find('video').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.find('video').exists()).toBe(true);

    // Blur stops preview
    await wrapper.find('button').trigger('blur');
    expect(wrapper.find('video').exists()).toBe(false);
  });

  it('falls back to video if poster fails', async () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    // Initially image
    const img = wrapper.find('img');
    expect(img.exists()).toBe(true);

    // Trigger error on image
    await img.trigger('error');

    // Should switch to video
    expect(wrapper.find('video').exists()).toBe(true);
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('clears hover timeout on mouseleave before debounce completes', async () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    // Enter
    await wrapper.trigger('mouseenter');

    // Leave before 500ms
    await vi.advanceTimersByTimeAsync(200);
    await wrapper.trigger('mouseleave');

    // Wait remaining time
    await vi.advanceTimersByTimeAsync(400);

    // Should still be image, never switched
    expect(wrapper.find('video').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('hides video if video loading/playback fails (even if hovered)', async () => {
    const item = {
      path: 'test.mp4',
      name: 'test.mp4',
      rating: 0,
      duration: 120,
    };
    const wrapper = mount(MediaGridItem, {
      props: {
        ...defaultProps,
        item,
      },
    });

    // Enter and wait
    await wrapper.trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.find('video').exists()).toBe(true);

    // Trigger video error
    await wrapper.find('video').trigger('error');

    // Should switch back to image/poster (assuming poster hasn't failed)
    expect(wrapper.find('video').exists()).toBe(false);
    expect(wrapper.find('img').exists()).toBe(true);
  });

  it('shows selection overlay when isSelected is true', () => {
    const item = { path: 'test.jpg', name: 'test.jpg', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, {
      props: { ...defaultProps, item, isSelected: true },
    });
    const overlay = wrapper.find('[aria-hidden="true"].border-accent');
    expect(overlay.exists()).toBe(true);
    expect(overlay.classes()).toContain('border-2');
  });

  it('does not show selection overlay when isSelected is false', () => {
    const item = { path: 'test.jpg', name: 'test.jpg', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, {
      props: { ...defaultProps, item, isSelected: false },
    });
    expect(wrapper.find('[aria-hidden="true"].border-accent').exists()).toBe(
      false,
    );
  });

  it('shows transcode badge for pending status', () => {
    const item = { path: 'test.mp4', name: 'test.mp4', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, {
      props: { ...defaultProps, item, transcodeStatus: 'pending' },
    });
    const badge = wrapper.find('[title="Transcode: pending"]');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).toContain('bg-gray-600/90');
    expect(badge.text()).toContain('pending');
  });

  it('shows transcode badge for processing status', () => {
    const item = { path: 'test.mp4', name: 'test.mp4', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, {
      props: { ...defaultProps, item, transcodeStatus: 'processing' },
    });
    const badge = wrapper.find('[title="Transcode: processing"]');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).toContain('bg-blue-600/90');
    expect(badge.text()).toContain('HLS');
  });

  it('shows transcode badge for done status', () => {
    const item = { path: 'test.mp4', name: 'test.mp4', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, {
      props: { ...defaultProps, item, transcodeStatus: 'done' },
    });
    const badge = wrapper.find('[title="Transcode: done"]');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).toContain('bg-green-600/90');
    expect(badge.text()).toContain('done');
  });

  it('shows transcode badge for failed status', () => {
    const item = { path: 'test.mp4', name: 'test.mp4', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, {
      props: { ...defaultProps, item, transcodeStatus: 'failed' },
    });
    const badge = wrapper.find('[title="Transcode: failed"]');
    expect(badge.exists()).toBe(true);
    expect(badge.classes()).toContain('bg-red-600/90');
    expect(badge.text()).toContain('failed');
  });

  it('does not show transcode badge when transcodeStatus is undefined', () => {
    const item = { path: 'test.jpg', name: 'test.jpg', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, { props: { ...defaultProps, item } });
    expect(wrapper.find('[title^="Transcode:"]').exists()).toBe(false);
  });

  it('emits click event with item and mouse event', async () => {
    const item = { path: 'test.jpg', name: 'test.jpg', rating: 0, duration: 0 };
    const wrapper = mount(MediaGridItem, { props: { ...defaultProps, item } });
    await wrapper.find('button').trigger('click');
    const emitted = wrapper.emitted('click');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual(item);
    expect(emitted![0][1]).toBeInstanceOf(MouseEvent);
  });

  describe('Google Drive & Offline Cache', () => {
    const driveItem = {
      path: 'gdrive://file123',
      name: 'Drive Video.mp4',
      rating: 0,
      duration: 120,
    };

    /** The preload bridge the ElectronAdapter talks to, faked. */
    function useElectronBackend() {
      const listeners = new Set<(event: unknown, data: any) => void>();
      const bridge = {
        getDriveCacheStatus: vi.fn().mockResolvedValue({
          success: true,
          data: { status: 'cloud', progress: 0 },
        }),
        triggerDriveCache: vi
          .fn()
          .mockResolvedValue({ success: true, data: undefined }),
        onDriveCacheProgress: vi.fn((callback) => {
          listeners.add(callback);
          return () => listeners.delete(callback);
        }),
      };
      backend.current = new ElectronAdapter(bridge as any);
      const emit = (event: Partial<DriveCacheProgressEvent>) => {
        for (const listener of listeners) {
          listener(
            {},
            {
              fileId: 'file123',
              status: 'syncing',
              progress: 0,
              downloadedBytes: 0,
              totalSize: 100,
              ...event,
            },
          );
        }
      };
      return { bridge, emit, listeners };
    }

    const mountDrive = (item = driveItem) =>
      mount(MediaGridItem, { props: { ...defaultProps, item } });

    const downloadButton = (wrapper: ReturnType<typeof mountDrive>) =>
      wrapper.find('button[aria-label*="offline cache"]');

    afterEach(() => {
      backend.current = null;
    });

    it('walks through cloud, syncing and ready', async () => {
      const { bridge, emit, listeners } = useElectronBackend();
      const wrapper = mountDrive();

      await vi.waitFor(() =>
        expect(bridge.getDriveCacheStatus).toHaveBeenCalledWith('file123'),
      );
      const button = wrapper.find('button[title="Download to offline cache"]');
      expect(button.exists()).toBe(true);
      bridge.getDriveCacheStatus.mockResolvedValue({
        success: true,
        data: { status: 'syncing', progress: 0 },
      });

      await button.trigger('click');
      expect(bridge.triggerDriveCache).toHaveBeenCalledWith('file123');
      expect(wrapper.emitted('click')).toBeUndefined();
      await vi.waitFor(() =>
        expect(wrapper.find('[title="Syncing: 0%"]').exists()).toBe(true),
      );

      emit({ status: 'syncing', progress: 0.5 });
      await wrapper.vm.$nextTick();
      const syncing = wrapper.find('[title="Syncing: 50%"]');
      expect(syncing.exists()).toBe(true);
      expect(syncing.attributes('role')).toBe('img');
      expect(syncing.attributes('aria-label')).toBe(
        'Downloading to offline cache: 50%',
      );

      emit({ status: 'ready', progress: 1 });
      await wrapper.vm.$nextTick();
      const ready = wrapper.find('[title="Ready Offline"]');
      expect(ready.attributes('aria-label')).toBe('Available offline');

      wrapper.unmount();
      expect(listeners.size).toBe(0);
    });

    it('keeps the download control out of the tile button (F159)', async () => {
      useElectronBackend();
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );

      const tile = wrapper.find('button.grid-item');
      expect(tile.attributes('aria-label')).toBe(
        'View Drive Video.mp4, Video, 120 sec',
      );
      expect(tile.findAll('button, a, input, [tabindex]')).toHaveLength(0);
      expect(
        downloadButton(wrapper).element.parentElement?.closest('button'),
      ).toBeNull();
    });

    it('lets clicks on the cache badges fall through to the tile button', async () => {
      const { emit } = useElectronBackend();
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );

      // The overlay sits above the tile button, so only the download button
      // may take pointer events; the badge area must stay part of the tile.
      const container = downloadButton(wrapper).element.parentElement;
      expect(container?.classList.contains('pointer-events-none')).toBe(true);
      expect(downloadButton(wrapper).classes()).toContain(
        'pointer-events-auto',
      );

      emit({ status: 'syncing', progress: 0.5 });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[title="Syncing: 50%"]').classes()).toContain(
        'pointer-events-none',
      );

      emit({ status: 'ready', progress: 1 });
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[title="Ready Offline"]').classes()).toContain(
        'pointer-events-none',
      );
    });

    it('shows why a download could not start and lets the user retry (F129)', async () => {
      const { bridge } = useElectronBackend();
      bridge.triggerDriveCache.mockResolvedValueOnce({
        success: false,
        error:
          'File is too large for the offline cache (6.0 GB; the limit is 5.0 GB)',
      });
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );

      await downloadButton(wrapper).trigger('click');

      await vi.waitFor(() =>
        expect(downloadButton(wrapper).attributes('title')).toBe(
          'Offline download failed: File is too large for the offline cache (6.0 GB; the limit is 5.0 GB). Retry download to offline cache',
        ),
      );
      expect(downloadButton(wrapper).classes()).toContain('bg-red-600/90');
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to trigger cache download:',
        expect.any(Error),
      );

      await downloadButton(wrapper).trigger('click');
      expect(bridge.triggerDriveCache).toHaveBeenCalledTimes(2);
      consoleSpy.mockRestore();
    });

    it('shows a download that failed in the background', async () => {
      const { emit } = useElectronBackend();
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );

      emit({ status: 'syncing', progress: 0.2 });
      await wrapper.vm.$nextTick();
      expect(downloadButton(wrapper).exists()).toBe(false);

      emit({ status: 'error', progress: 0.2, error: 'ECONNRESET' });
      await wrapper.vm.$nextTick();
      expect(downloadButton(wrapper).attributes('aria-label')).toContain(
        'Offline download failed: ECONNRESET',
      );

      emit({ status: 'error', progress: 0.2 });
      await wrapper.vm.$nextTick();
      expect(downloadButton(wrapper).attributes('aria-label')).toContain(
        'Offline download failed: Download failed',
      );
    });

    it('re-reads the status after a trigger, e.g. for a file that finished at once', async () => {
      const { bridge } = useElectronBackend();
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );
      bridge.getDriveCacheStatus.mockResolvedValue({
        success: true,
        data: { status: 'ready', progress: 1 },
      });

      await downloadButton(wrapper).trigger('click');

      await vi.waitFor(() =>
        expect(wrapper.find('[title="Ready Offline"]').exists()).toBe(true),
      );
      expect(bridge.getDriveCacheStatus).toHaveBeenCalledTimes(2);
    });

    it('hides the control in the web version without calling any Drive cache API (F130)', async () => {
      backend.current = new WebAdapter();
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const statusSpy = vi.spyOn(WebAdapter.prototype, 'getDriveCacheStatus');

      const wrapper = mountDrive();
      await wrapper.vm.$nextTick();

      expect(downloadButton(wrapper).exists()).toBe(false);
      expect(wrapper.find('[title="Ready Offline"]').exists()).toBe(false);
      expect(statusSpy).not.toHaveBeenCalled();
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
      statusSpy.mockRestore();
    });

    it('does not touch the backend for local files', async () => {
      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item: { path: 'local/video.mp4', name: 'video.mp4' },
        },
      });
      await wrapper.vm.$nextTick();
      // backend.current is null here: any access would throw.
      expect(downloadButton(wrapper).exists()).toBe(false);
    });

    it('logs a failed status request', async () => {
      const { bridge } = useElectronBackend();
      bridge.getDriveCacheStatus.mockRejectedValue(new Error('IPC closed'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mountDrive();

      await vi.waitFor(() =>
        expect(consoleSpy).toHaveBeenCalledWith(
          'Failed to get cache status:',
          expect.any(Error),
        ),
      );
      consoleSpy.mockRestore();
    });

    it('follows the tile to another file and drops late replies about the old one', async () => {
      const { bridge, listeners } = useElectronBackend();
      let answerOld!: (value: unknown) => void;
      bridge.getDriveCacheStatus.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answerOld = resolve;
          }),
      );
      bridge.getDriveCacheStatus.mockResolvedValue({
        success: true,
        data: { status: 'cloud', progress: 0 },
      });
      const wrapper = mountDrive();

      await wrapper.setProps({
        item: { ...driveItem, path: 'gdrive://file456' },
      });
      expect(bridge.getDriveCacheStatus).toHaveBeenLastCalledWith('file456');
      answerOld({ success: true, data: { status: 'ready', progress: 1 } });

      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );
      expect(wrapper.find('[title="Ready Offline"]').exists()).toBe(false);
      expect(listeners.size).toBe(1);

      await wrapper.setProps({
        item: { path: 'local/video.mp4', name: 'video.mp4' },
      });
      expect(downloadButton(wrapper).exists()).toBe(false);
      expect(listeners.size).toBe(0);
    });

    it('ignores the outcome of a trigger for a file the tile no longer shows', async () => {
      const { bridge } = useElectronBackend();
      let finishTrigger!: (value: unknown) => void;
      bridge.triggerDriveCache.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishTrigger = resolve;
          }),
      );
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );

      await downloadButton(wrapper).trigger('click');
      await wrapper.setProps({
        item: { ...driveItem, path: 'gdrive://file456' },
      });
      finishTrigger({ success: false, error: 'Network down' });

      await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());
      await wrapper.vm.$nextTick();
      expect(downloadButton(wrapper).attributes('title')).toBe(
        'Download to offline cache',
      );
      consoleSpy.mockRestore();
    });

    it('ignores clicks while a download is already running', async () => {
      const { bridge, emit } = useElectronBackend();
      const wrapper = mountDrive();
      await vi.waitFor(() =>
        expect(downloadButton(wrapper).exists()).toBe(true),
      );
      const vm = wrapper.vm as unknown as {
        triggerOfflineDownload: () => Promise<void>;
      };

      emit({ status: 'syncing', progress: 0.1 });
      await vm.triggerOfflineDownload();

      expect(bridge.triggerDriveCache).not.toHaveBeenCalled();
    });
  });

  describe('Image and Poster Error Handling', () => {
    it('retries image load with full url', async () => {
      const item = {
        path: 'image.jpg',
        name: 'image.jpg',
        rating: 0,
        duration: 0,
      };
      const failedPaths = new Set<string>();
      const mockGenerator = vi.fn((p) => `/full-url/${p}`);

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
          mediaUrlGenerator: mockGenerator,
          failedImagePaths: failedPaths,
        },
      });

      const img = wrapper.find('img');
      const imgEl = img.element as HTMLImageElement;

      // Mock the browser location URL resolution
      Object.defineProperty(imgEl, 'src', {
        writable: true,
        value: 'http://localhost/other-src.jpg',
      });

      imgEl.dispatchEvent(new Event('error'));
      await wrapper.vm.$nextTick();

      expect(imgEl.src).toBe('/full-url/image.jpg');
      expect(failedPaths.has('image.jpg')).toBe(false);
    });

    it('marks image as failed if full url retry fails', async () => {
      const item = {
        path: 'image.jpg',
        name: 'image.jpg',
        rating: 0,
        duration: 0,
      };
      const failedPaths = new Set<string>();
      const mockGenerator = vi.fn((p) => `/full-url/${p}`);

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
          mediaUrlGenerator: mockGenerator,
          failedImagePaths: failedPaths,
        },
      });

      const img = wrapper.find('img');
      const imgEl = img.element as HTMLImageElement;

      // Make src match full url so it represents a full failure
      Object.defineProperty(imgEl, 'src', {
        writable: true,
        value: new URL('/full-url/image.jpg', window.location.href).href,
      });

      imgEl.dispatchEvent(new Event('error'));
      await wrapper.vm.$nextTick();

      expect(failedPaths.has('image.jpg')).toBe(true);
    });

    it('handles poster error to show fallback video', async () => {
      const item = {
        path: 'video.mp4',
        name: 'video.mp4',
        rating: 0,
        duration: 120,
      };
      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
        },
      });

      const img = wrapper.find('img');
      await img.trigger('error'); // Triggers handlePosterError

      // Should show video now
      expect(wrapper.find('video').exists()).toBe(true);
    });
  });

  describe('Skeleton Loader branch coverage', () => {
    it('shows skeleton for loading image', () => {
      const item = {
        path: 'image.jpg',
        name: 'image.jpg',
        rating: 0,
        duration: 0,
      };
      const failedPaths = new Set<string>();
      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
          failedImagePaths: failedPaths,
        },
      });

      // By default isLoading is true
      expect(wrapper.find('.animate-pulse').exists()).toBe(true);
    });

    it('shows skeleton for loading video with poster', () => {
      const item = {
        path: 'video.mp4',
        name: 'video.mp4',
        rating: 0,
        duration: 120,
      };
      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
        },
      });

      expect(wrapper.find('.animate-pulse').exists()).toBe(true);
    });
  });

  describe('Extra Branch Coverage for MediaGridItem', () => {
    it('uses mediaUrlGenerator as fallback for mediaUrl when thumbnailUrlGenerator is null', () => {
      const item = {
        path: 'test.jpg',
        name: 'test.jpg',
        rating: 0,
        duration: 0,
      };
      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
          thumbnailUrlGenerator: null,
        },
      });
      expect((wrapper.vm as any).mediaUrl).toBe('test.jpg');
      expect((wrapper.vm as any).posterUrl).toBe('');
    });

    it('returns false for showSkeleton if neither image nor video', () => {
      const item = {
        path: 'test.unknown',
        name: 'test.unknown',
        rating: 0,
        duration: 0,
      };
      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
          imageExtensionsSet: new Set<string>(),
          videoExtensionsSet: new Set<string>(),
        },
      });
      expect((wrapper.vm as any).showSkeleton).toBe(false);
    });
  });
});
