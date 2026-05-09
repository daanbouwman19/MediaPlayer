import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaControls from '@/components/MediaControls.vue';
import { useUIStore } from '@/composables/useUIStore';

// Minimal Mocks needed for rendering
vi.mock('@/api', () => ({
  api: {
    getHeatmapProgress: vi.fn(),
    getHeatmap: vi.fn(),
    getMetadata: vi.fn(),
  },
}));

vi.mock('@/components/icons/VlcIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/StarIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/ChevronLeftIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/ChevronRightIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/VRIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/PlayIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/PauseIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/ExpandIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/VolumeUpIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/VolumeOffIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/SpinnerIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/icons/HelpIcon.vue', () => ({
  default: { template: '<svg class="help-icon-mock"></svg>' },
}));

vi.mock('@/components/ProgressBar.vue', () => ({
  default: { template: '<div></div>', props: ['currentTime', 'duration'] },
}));

describe('MediaControls.vue Shortcuts', () => {
  let originalGetBoundingClientRect: any;

  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useUIStore().isSidebarVisible = false;
  });

  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      constructor(callback: any) {
        callback([{ contentRect: { width: 1000 } }]);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    };

    originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 1000 }),
    });
  });

  afterAll(() => {
    delete (global as any).ResizeObserver;
    if (originalGetBoundingClientRect) {
      Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: originalGetBoundingClientRect,
      });
    }
  });

  const defaultProps = {
    currentMediaItem: { name: 'video.mp4', path: '/video.mp4', rating: 0 },
    isPlaying: false,
    canNavigate: true,
    isControlsVisible: true,
    isImage: false,
  };

  it('should render the help/shortcuts button', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    await wrapper.vm.$nextTick();

    const helpBtn = wrapper.find('button[aria-label="Keyboard Shortcuts"]');
    expect(helpBtn.exists()).toBe(true);
    expect(helpBtn.attributes('title')).toBe('Keyboard Shortcuts (?)');
  });

  it('should emit open-shortcuts when help button is clicked', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });
    await wrapper.vm.$nextTick();

    const helpBtn = wrapper.find('button[aria-label="Keyboard Shortcuts"]');
    await helpBtn.trigger('click');

    expect(wrapper.emitted('open-shortcuts')).toBeTruthy();
    expect(wrapper.emitted('open-shortcuts')!.length).toBe(1);
  });

  it('should NOT render the help button if it is an image', async () => {
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: true },
    });
    await wrapper.vm.$nextTick();

    const helpBtn = wrapper.find('button[aria-label="Keyboard Shortcuts"]');
    expect(helpBtn.exists()).toBe(false);
  });
});
