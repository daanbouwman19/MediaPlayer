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

vi.mock('@/api', () => ({
  api: {
    getHeatmapProgress: vi.fn(),
    getHeatmap: vi.fn(),
    getMetadata: vi.fn(),
  },
}));

const disconnectMock = vi.fn();
const observeMock = vi.fn();

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    constructor(callback: any) {
      callback([{ contentRect: { width: 1000 } }]);
    }
    observe = observeMock;
    disconnect = disconnectMock;
    unobserve = vi.fn();
  };
});

afterAll(() => {
  delete (global as any).ResizeObserver;
});

const mockIcon = vi.hoisted(() => ({ default: { template: '<svg></svg>' } }));
vi.mock('@/components/atoms/icons/VlcIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/StarIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/ChevronLeftIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/ChevronRightIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/VRIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/PlayIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/PauseIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/ExpandIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/VolumeUpIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/VolumeOffIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/icons/SpinnerIcon.vue', () => mockIcon);
vi.mock('@/components/atoms/ProgressBar.vue', () => ({
  default: { template: '<div></div>' },
}));

describe('MediaControls Time Display', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useUIStore().isSidebarVisible = false;
  });

  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 1000 }),
    });
  });

  const defaultProps = {
    currentMediaItem: { name: 'test.mp4', path: '/test.mp4', rating: 0 },
    isPlaying: false,
    canNavigate: true,
    isControlsVisible: true,
    isImage: false,
    currentTime: 10,
    duration: 70,
  };

  it('should toggle between total and remaining time', async () => {
    const wrapper = mount(MediaControls, { props: defaultProps });

    await wrapper.vm.$nextTick();

    const timeDisplay = wrapper.find('[data-testid="time-display"]');

    expect(timeDisplay.text()).toBe('00:10 / 01:10');
    expect(timeDisplay.attributes('title')).toBe('Show remaining time');

    await timeDisplay.trigger('click');
    expect(timeDisplay.text()).toBe('00:10 / -01:00');
    expect(timeDisplay.attributes('title')).toBe('Show total duration');

    await timeDisplay.trigger('click');
    expect(timeDisplay.text()).toBe('00:10 / 01:10');
  });
});
