import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from 'vitest';
import { mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import MediaControls from '@/features/player/MediaControls.vue';
import { useUIStore } from '@/composables/useUIStore';

vi.mock('@/components/atoms/icons/VlcIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/StarIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/ChevronLeftIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/ChevronRightIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/PlayIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/PauseIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/ExpandIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));
vi.mock('@/components/atoms/icons/VRIcon.vue', () => ({
  default: { template: '<svg></svg>' },
}));

describe('MediaControls.vue Responsiveness', () => {
  const defaultProps = {
    currentMediaItem: { name: 'test.jpg', path: '/test.jpg', rating: 3 },
    isPlaying: false,
    canNavigate: true,
    isControlsVisible: true,
    isImage: true,
    currentTime: 10,
    duration: 100,
  };

  let disconnectMock: any;
  let observeMock: any;
  let resizeCallback: any;

  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useUIStore().isSidebarVisible = true;
  });

  beforeAll(() => {
    disconnectMock = vi.fn();
    observeMock = vi.fn();

    global.ResizeObserver = class ResizeObserver {
      constructor(callback: any) {
        resizeCallback = callback;
      }
      observe = observeMock;
      disconnect = disconnectMock;
      unobserve = vi.fn();
    };
  });

  afterAll(() => {
    delete (global as any).ResizeObserver;
  });

  const triggerResize = (width: number) => {
    if (resizeCallback) {
      resizeCallback([{ contentRect: { width } }]);
    }
  };

  it('should show stars and time when width is large (Desktop)', async () => {
    window.innerWidth = 1024;

    const wrapper = mount(MediaControls, {
      props: defaultProps,
      attachTo: document.body,
    });

    triggerResize(800);
    await wrapper.vm.$nextTick();

    const stars = wrapper.findAll('button[aria-label*="Rate"]');
    expect(stars.length).toBe(5);
    await wrapper.setProps({ isImage: false });

    const timeDisplayVideo = wrapper.find('.font-mono');
    expect(timeDisplayVideo.exists()).toBe(true);
    expect(timeDisplayVideo.text()).toContain('00:10 / 01:40');
  });

  it('should hide stars but keep time when width is medium', async () => {
    window.innerWidth = 1024;
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
      attachTo: document.body,
    });

    triggerResize(500);
    await wrapper.vm.$nextTick();

    const stars = wrapper.findAll('button[aria-label*="Rate"]');
    expect(stars.length).toBe(0);

    expect(wrapper.find('.font-mono').exists()).toBe(true);
  });

  it('should hide stars and time when width is very small', async () => {
    window.innerWidth = 1024;
    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
      attachTo: document.body,
    });

    triggerResize(200);
    await wrapper.vm.$nextTick();

    const stars = wrapper.findAll('button[aria-label*="Rate"]');
    expect(stars.length).toBe(0);

    const timeDisplay = wrapper.find('.font-mono');
    expect(timeDisplay.exists()).toBe(false);
  });

  it('should hide stars but show time on mobile with a wide container', async () => {
    window.innerWidth = 500;
    window.dispatchEvent(new Event('resize'));

    const wrapper = mount(MediaControls, {
      props: { ...defaultProps, isImage: false },
      attachTo: document.body,
    });

    triggerResize(800);
    await wrapper.vm.$nextTick();

    const stars = document.body.querySelectorAll('button[aria-label*="Rate"]');
    expect(stars.length).toBe(0);

    const timeDisplay = document.body.querySelector('.font-mono');
    expect(timeDisplay).not.toBeNull();
  });
});
