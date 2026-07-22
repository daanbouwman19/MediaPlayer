import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import VRVideoPlayer from '@/features/player/VRVideoPlayer.vue';

// Mock Three.js dependencies
vi.mock('three', () => {
  const Scene = vi.fn(function () {
    return {
      add: vi.fn(), // Mock the add method
      remove: vi.fn(),
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
      dispose: vi.fn(),
    };
  });
  const SphereGeometry = vi.fn(function () {
    return {
      scale: vi.fn(),
      dispose: vi.fn(),
    };
  });
  const MeshBasicMaterial = vi.fn(function () {
    return { dispose: vi.fn() };
  });
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
      dispose: vi.fn(),
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
    // Yield to the event loop so that setTimeout 0 in RAF triggers component update.
    await new Promise((resolve) => setTimeout(resolve, 50)); // use 50ms to be safe that async loop completes
    await wrapper.vm.$nextTick();

    // Check style directly to confirm display: none is applied.
    // In Vue Test Utils, stubs for transition often just use v-show fallback logic
    // rather than full conditional rendering depending on test runner config.
    // In Vue 3 Test Utils, transition stub adds 'display: none' via v-show mechanics even for v-if sometimes.
    const updatedContainer = wrapper.find(
      '[data-testid="vr-controls-container"]',
    );
    const isHidden =
      !updatedContainer.exists() ||
      (updatedContainer.element &&
        (updatedContainer.element as HTMLElement).style.display === 'none');
    expect(isHidden).toBe(true);
  });
});
