import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import VRVideoPlayer from '@/features/player/VRVideoPlayer.vue';
import { vi } from 'vitest';

// Fix the mocks to be constructable classes (functions)
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

describe('VRVideoPlayer A11y', () => {
  it('has accessible label for Play/Pause button', async () => {
    const wrapper = mount(VRVideoPlayer, {
      props: {
        src: 'test.mp4',
        isPlaying: false,
        isControlsVisible: true,
      },
    });

    // Wait for initThree to complete
    await wrapper.vm.$nextTick();

    const buttons = wrapper.findAll('button');
    const playPauseBtn = buttons[0];

    expect(playPauseBtn.attributes('aria-label')).toBe('Play video');
    expect(playPauseBtn.attributes('title')).toBe('Play video');

    await wrapper.setProps({ isPlaying: true });
    expect(playPauseBtn.attributes('aria-label')).toBe('Pause video');
    expect(playPauseBtn.attributes('title')).toBe('Pause video');
  });

  it('has title for Exit Fullscreen button', async () => {
    const wrapper = mount(VRVideoPlayer, {
      props: {
        src: 'test.mp4',
        isPlaying: false,
        isControlsVisible: true,
      },
    });

    // Wait for initThree to complete
    await wrapper.vm.$nextTick();

    // Manually set the internal state 'isFullscreen' to true
    (wrapper.vm as any).isFullscreen = true;
    await wrapper.vm.$nextTick();

    const exitBtn = wrapper.find('button[aria-label="Exit Fullscreen"]');
    expect(exitBtn.exists()).toBe(true);
    expect(exitBtn.attributes('title')).toBe('Exit Fullscreen');
  });
});
