import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaControls from '../../src/renderer/components/MediaControls.vue';
import { useUIStore } from '../../src/renderer/composables/useUIStore';

// Mock API
vi.mock('../../src/renderer/api/index', () => ({
  api: {
    getHeatmapProgress: vi.fn(),
    getHeatmap: vi.fn(),
    getMetadata: vi.fn(),
  },
}));

describe('MediaControls', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useUIStore().isSidebarVisible = false;
  });

  it('renders VLC button with loading state when isOpeningVlc is true', async () => {
    // Mock desktop size
    vi.stubGlobal('innerWidth', 1024);

    const wrapper = mount(MediaControls, {
      props: {
        currentMediaItem: {
          id: '1',
          path: '/path/to/video.mp4',
          name: 'video.mp4',
          type: 'video',
          isDirectory: false,
          birthtime: new Date(),
          mtime: new Date(),
          size: 1000,
        },
        isPlaying: false,
        canNavigate: true,
        isControlsVisible: true,
        isImage: false,
        isOpeningVlc: true,
      },
      global: {
        stubs: {
          VlcIcon: true,
          VRIcon: true,
          ChevronLeftIcon: true,
          ChevronRightIcon: true,
          PlayIcon: true,
          PauseIcon: true,
          ExpandIcon: true,
          StarIcon: true,
          ProgressBar: true,
          // Render content of Teleport in place
          Teleport: {
            template: '<div><slot /></div>',
          },
        },
      },
    });

    // Find the VLC button
    // It should have the title "Opening VLC..."
    const vlcButton = wrapper.find('button[title="Opening VLC..."]');

    expect(vlcButton.exists()).toBe(true);
    expect(vlcButton.attributes('disabled')).toBeDefined();
    expect(vlcButton.classes()).toContain('cursor-wait');

    // Check for spinner
    expect(vlcButton.find('svg.animate-spin').exists()).toBe(true);
  });

  it('renders VLC button normally when isOpeningVlc is false', async () => {
    vi.stubGlobal('innerWidth', 1024);

    const wrapper = mount(MediaControls, {
      props: {
        currentMediaItem: {
          id: '1',
          path: '/path/to/video.mp4',
          name: 'video.mp4',
          type: 'video',
          isDirectory: false,
          birthtime: new Date(),
          mtime: new Date(),
          size: 1000,
        },
        isPlaying: false,
        canNavigate: true,
        isControlsVisible: true,
        isImage: false,
        isOpeningVlc: false,
      },
      global: {
        stubs: {
          VlcIcon: true,
          VRIcon: true,
          ChevronLeftIcon: true,
          ChevronRightIcon: true,
          PlayIcon: true,
          PauseIcon: true,
          ExpandIcon: true,
          StarIcon: true,
          ProgressBar: true,
          Teleport: {
            template: '<div><slot /></div>',
          },
        },
      },
    });

    const vlcButton = wrapper.find('button[title="Open in VLC"]');
    expect(vlcButton.exists()).toBe(true);
    expect(vlcButton.attributes('disabled')).toBeUndefined();
    expect(vlcButton.classes()).not.toContain('cursor-wait');

    // Check for VlcIcon
    expect(vlcButton.findComponent({ name: 'VlcIcon' }).exists()).toBe(true);
  });
});
