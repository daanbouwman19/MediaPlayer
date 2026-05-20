import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import MediaGridItem from '../../../src/renderer/components/MediaGridItem.vue';

// Mock formatDurationForA11y to return predictable strings
vi.mock('../../../src/renderer/utils/timeUtils', async () => {
  const actual = await vi.importActual('../../../src/renderer/utils/timeUtils');
  return {
    ...(actual as any),
    formatDurationForA11y: (s: number) => `${s} sec`,
  };
});

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
    await wrapper.find('button').trigger('mouseenter');

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
    await wrapper.find('button').trigger('mouseenter');
    await vi.advanceTimersByTimeAsync(500);
    expect(wrapper.find('video').exists()).toBe(true);

    // Leave
    await wrapper.find('button').trigger('mouseleave');
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
    await wrapper.find('button').trigger('mouseenter');

    // Leave before 500ms
    await vi.advanceTimersByTimeAsync(200);
    await wrapper.find('button').trigger('mouseleave');

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
    await wrapper.find('button').trigger('mouseenter');
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
    let mockDriveCacheProgressCallback: any = null;
    const mockGetDriveCacheStatus = vi.fn();
    const mockTriggerDriveCache = vi.fn();
    const mockOnDriveCacheProgress = vi.fn((cb) => {
      mockDriveCacheProgressCallback = cb;
      return () => {
        mockDriveCacheProgressCallback = null;
      };
    });

    beforeEach(() => {
      mockDriveCacheProgressCallback = null;
      mockGetDriveCacheStatus.mockReset();
      mockTriggerDriveCache.mockReset();
      mockOnDriveCacheProgress.mockClear();

      (global as any).window = global;
      (global as any).window.electronAPI = {
        getDriveCacheStatus: mockGetDriveCacheStatus,
        triggerDriveCache: mockTriggerDriveCache,
        onDriveCacheProgress: mockOnDriveCacheProgress,
      };
    });

    it('handles Google Drive cloud/syncing/ready status', async () => {
      const item = {
        path: 'gdrive://file123',
        name: 'Drive Video.mp4',
        rating: 0,
        duration: 120,
      };
      mockGetDriveCacheStatus.mockResolvedValue({
        success: true,
        data: { status: 'cloud', progress: 0 },
      });

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
        },
      });

      // Let onMounted async call run
      await new Promise(process.nextTick);
      expect(mockGetDriveCacheStatus).toHaveBeenCalledWith('file123');
      expect(mockOnDriveCacheProgress).toHaveBeenCalled();

      // Click triggerOfflineDownload
      const downloadBtn = wrapper.find(
        'button[title="Download to offline cache"]',
      );
      expect(downloadBtn.exists()).toBe(true);
      await downloadBtn.trigger('click');

      expect(mockTriggerDriveCache).toHaveBeenCalledWith('file123');

      // Trigger cache progress via callback
      if (mockDriveCacheProgressCallback) {
        mockDriveCacheProgressCallback(
          {},
          { fileId: 'file123', progress: 0.5 },
        );
      }
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[title^="Syncing: 50%"]').exists()).toBe(true);

      // Trigger progress complete
      if (mockDriveCacheProgressCallback) {
        mockDriveCacheProgressCallback(
          {},
          { fileId: 'file123', progress: 1.0 },
        );
      }
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[title="Ready Offline"]').exists()).toBe(true);

      // Unmount unsubscribes
      wrapper.unmount();
      expect(mockDriveCacheProgressCallback).toBeNull();
    });

    it('resets and updates on path change', async () => {
      const item1 = {
        path: 'gdrive://file123',
        name: 'Drive Video.mp4',
        rating: 0,
        duration: 120,
      };
      mockGetDriveCacheStatus.mockResolvedValue({
        success: true,
        data: { status: 'ready', progress: 1.0 },
      });

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item: item1,
        },
      });

      await new Promise(process.nextTick);
      expect(mockGetDriveCacheStatus).toHaveBeenCalledTimes(1);

      // Change path to non-drive item
      const item2 = {
        path: 'local/video.mp4',
        name: 'Local Video.mp4',
        rating: 0,
        duration: 120,
      };
      await wrapper.setProps({ item: item2 });

      expect(
        wrapper.find('button[title="Download to offline cache"]').exists(),
      ).toBe(false);
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

    it('logs error when getDriveCacheStatus fails', async () => {
      const item = {
        path: 'gdrive://file123',
        name: 'Drive Video.mp4',
        rating: 0,
        duration: 120,
      };
      const mockGetDriveCacheStatus = vi
        .fn()
        .mockRejectedValue(new Error('Cache API error'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      (global as any).window = global;
      (global as any).window.electronAPI = {
        getDriveCacheStatus: mockGetDriveCacheStatus,
        triggerDriveCache: vi.fn(),
        onDriveCacheProgress: vi.fn(() => () => {}),
      };

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
        },
      });

      await new Promise(process.nextTick);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to get cache status'),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
      wrapper.unmount();
    });

    it('handles error when triggerDriveCache fails', async () => {
      const item = {
        path: 'gdrive://file123',
        name: 'Drive Video.mp4',
        rating: 0,
        duration: 120,
      };
      const mockGetDriveCacheStatus = vi.fn().mockResolvedValue({
        success: true,
        data: { status: 'cloud', progress: 0 },
      });
      const mockTriggerDriveCache = vi
        .fn()
        .mockRejectedValue(new Error('Trigger fail'));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      (global as any).window = global;
      (global as any).window.electronAPI = {
        getDriveCacheStatus: mockGetDriveCacheStatus,
        triggerDriveCache: mockTriggerDriveCache,
        onDriveCacheProgress: vi.fn(() => () => {}),
      };

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
        },
      });

      await new Promise(process.nextTick);

      const downloadBtn = wrapper.find(
        'button[title="Download to offline cache"]',
      );
      await downloadBtn.trigger('click');

      expect(mockTriggerDriveCache).toHaveBeenCalledWith('file123');
      await wrapper.vm.$nextTick();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to trigger cache download'),
        expect.any(Error),
      );
      expect((wrapper.vm as any).cacheStatus).toBe('cloud');
      consoleSpy.mockRestore();
      wrapper.unmount();
    });

    it('cleans up duplicate progress subscription', async () => {
      const item = {
        path: 'gdrive://file123',
        name: 'Drive Video.mp4',
        rating: 0,
        duration: 120,
      };
      const unsubscribeSpy = vi.fn();
      const mockOnDriveCacheProgress = vi.fn(() => unsubscribeSpy);

      (global as any).window = global;
      (global as any).window.electronAPI = {
        getDriveCacheStatus: vi
          .fn()
          .mockResolvedValue({ success: true, data: { status: 'cloud' } }),
        triggerDriveCache: vi.fn(),
        onDriveCacheProgress: mockOnDriveCacheProgress,
      };

      const wrapper = mount(MediaGridItem, {
        props: {
          ...defaultProps,
          item,
        },
      });

      await new Promise(process.nextTick);

      const newItem = {
        path: 'gdrive://file456',
        name: 'Drive Video 2.mp4',
        rating: 0,
        duration: 120,
      };
      await wrapper.setProps({ item: newItem });
      await new Promise(process.nextTick);

      expect(unsubscribeSpy).toHaveBeenCalled();
      wrapper.unmount();
    });
  });
});
