import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import VRVideoPlayer from '@/features/player/VRVideoPlayer.vue';
import * as THREE from 'three';

// Mock Three.js
vi.mock('three', () => {
  const Scene = vi.fn(function () {
    return {
      add: vi.fn(),
    };
  });
  const PerspectiveCamera = vi.fn(function () {
    return {
      position: { set: vi.fn() },
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
      quaternion: { copy: vi.fn() },
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
      rotation: { y: -1 }, // Start with a non-zero value to ensure the component sets it.
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
    MathUtils: {
      degToRad: (deg: number) => (deg * Math.PI) / 180,
    },
    Euler: vi.fn(function () {
      return { set: vi.fn() };
    }),
    Quaternion: vi.fn(function () {
      return {
        setFromEuler: vi.fn(),
        multiply: vi.fn(),
        setFromAxisAngle: vi.fn().mockReturnThis(),
        copy: vi.fn(),
      };
    }),
    Vector3: vi.fn(),
  };
});

// Mock OrbitControls
vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: vi.fn(function () {
    return {
      target: { set: vi.fn() },
      update: vi.fn(),
      enableZoom: true,
      enablePan: true,
      enableDamping: true,
      dampingFactor: 0.1,
      rotateSpeed: 1,
    };
  }),
}));

describe('VRVideoPlayer.vue Orientation', () => {
  const defaultProps = {
    src: 'http://test/video.mp4',
    isPlaying: false,
    initialTime: 0,
    isControlsVisible: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes the mesh with 0 rotation (facing front)', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();
    // Wait for initThree
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(THREE.Mesh).toHaveBeenCalled();
    const meshInstance = (THREE.Mesh as any).mock.results[0].value;

    // We expect rotation.y to be 0 for correct alignment with -Z (Front)
    expect(meshInstance.rotation.y).toBe(0);
  });
});
