import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import VRVideoPlayer from '@/components/VRVideoPlayer.vue';

// Mock Three.js dependencies
vi.mock('three', () => {
  const Scene = vi.fn(function () {
    return {
      add: vi.fn(), // Mock the add method
    };
  });
  const PerspectiveCamera = vi.fn(function () {
    return {
      position: { set: vi.fn() },
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
    };
  });
  const WebGLRenderer = vi.fn(function () {
    return {
      setSize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
      domElement: document.createElement('canvas'),
    };
  });
  const VideoTexture = vi.fn(function () {
    return {
      colorSpace: '',
      repeat: { set: vi.fn() },
      offset: { set: vi.fn() },
      wrapS: 0,
      wrapT: 0,
    };
  });
  const SphereGeometry = vi.fn(function () {
    return {
      scale: vi.fn(),
    };
  });
  const MeshBasicMaterial = vi.fn();
  const Mesh = vi.fn(function () {
    return {
      rotation: { y: 0 },
    };
  });

  return {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    VideoTexture,
    SphereGeometry,
    MeshBasicMaterial,
    Mesh,
    SRGBColorSpace: 'SRGB',
    ClampToEdgeWrapping: 1001,
    MathUtils: { degToRad: vi.fn() },
    Euler: vi.fn(),
    Quaternion: vi.fn(),
    Vector3: vi.fn(),
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: vi.fn(function () {
    return {
      target: { set: vi.fn() },
      update: vi.fn(),
    };
  }),
}));

describe('VRVideoPlayer Visibility', () => {
  it('hides controls when isControlsVisible is false', async () => {
    const wrapper = mount(VRVideoPlayer, {
      props: {
        src: 'test.mp4',
        isPlaying: false,
        isControlsVisible: true,
      },
      global: {
        stubs: {
          transition: false,
        },
      },
    });

    // Wait for initial render
    await wrapper.vm.$nextTick();

    const controlsContainer = wrapper.find(
      '[data-testid="vr-controls-container"]',
    );
    expect(controlsContainer.exists()).toBe(true);

    // Set isControlsVisible to false
    await wrapper.setProps({ isControlsVisible: false });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // Wait for Vue's transition/render cycle
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick();

    // Check if the element exists
    expect(wrapper.find('[data-testid="vr-controls-container"]').exists()).toBe(
      false,
    );
  });
});
