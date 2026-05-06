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
});
