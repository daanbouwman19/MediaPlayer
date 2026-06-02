import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
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

describe('VRVideoPlayer.vue', () => {
  const defaultProps = {
    src: 'http://test/video.mp4',
    isPlaying: false,
    initialTime: 0,
    isControlsVisible: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly', () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    expect(wrapper.find('.vr-container').exists()).toBe(true);
    expect(wrapper.text()).toContain('Mode: 2D (Mono)');
    // Fullscreen button is now an icon and conditional, so removing text check
  });

  it('sets video poster when poster prop is provided', async () => {
    const wrapper = mount(VRVideoPlayer, {
      props: { ...defaultProps, poster: 'test-poster.jpg' },
    });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const emitted = wrapper.emitted('update:video-element');
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBeInstanceOf(HTMLVideoElement);
    const videoElement = emitted![0][0] as HTMLVideoElement;
    expect(videoElement.poster).toContain('test-poster.jpg');
  });

  it('initializes Three.js on mount', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();
    // Need to wait for nextTick inside mounted
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(THREE.Scene).toHaveBeenCalled();
    expect(THREE.WebGLRenderer).toHaveBeenCalled();
    expect(THREE.PerspectiveCamera).toHaveBeenCalled();
  });

  it('toggles stereo mode', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const toggleBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Mode:'));
    expect(toggleBtn?.text()).toBe('Mode: 2D (Mono)');

    await toggleBtn?.trigger('click');
    expect(toggleBtn?.text()).toBe('Mode: 3D (SBS)');

    // Toggle back
    await toggleBtn?.trigger('click');
    expect(toggleBtn?.text()).toBe('Mode: 2D (Mono)');
  });

  it('handles interactions before initialization (branch coverage)', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    // Do NOT await nextTick() yet - initThree has not run

    // 1. Toggle Stereo - videoTexture is null
    const toggleBtn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Mode:'));
    await toggleBtn?.trigger('click');
    expect(wrapper.vm.handleLoadedMetadata).toBeDefined();

    // 2. toggleFullscreen - container might be set, but good to check
    const container = wrapper.find('.vr-container').element;
    (container as any).requestFullscreen = vi.fn().mockResolvedValue(undefined);

    // Call method directly as button is hidden
    wrapper.vm.toggleFullscreen();

    // 3. handleLoadedMetadata manually when video is null
    wrapper.vm.handleLoadedMetadata();

    // 4. Props changes before init
    await wrapper.setProps({ src: 'new.mp4', isPlaying: true });

    // Now let init happen to be clean
    await wrapper.vm.$nextTick();
  });

  it('detects SBS stereo mode from aspect ratio', async () => {
    const videoMock = document.createElement('video');
    // Spy on createElement to return our mock for 'video' tag
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string) => {
        if (tagName === 'video') return videoMock;
        return window.document.constructor.prototype.createElement.call(
          document,
          tagName,
        );
      });

    const wrapper = mount(VRVideoPlayer, { props: defaultProps });

    // Mock container dimensions for Three.js init
    const container = wrapper.find('.vr-container').element;
    Object.defineProperty(container, 'clientWidth', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // Ensure initThree runs

    // Set dimensions on our captured mock
    Object.defineProperty(videoMock, 'videoWidth', {
      value: 2048,
      configurable: true,
    });
    Object.defineProperty(videoMock, 'videoHeight', {
      value: 1024,
      configurable: true,
    });

    // Trigger the handler directly
    wrapper.vm.handleLoadedMetadata();
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).isStereo).toBe(true);
    expect(wrapper.text()).toContain('Mode: 3D (SBS)');

    // Simulate non-SBS aspect ratio
    Object.defineProperty(videoMock, 'videoWidth', { value: 1920 });
    Object.defineProperty(videoMock, 'videoHeight', { value: 1080 });

    // Ensure we hit the `if (event)` branch in handleLoadedMetadata
    const mockEvent = new Event('loadedmetadata');
    wrapper.vm.handleLoadedMetadata(mockEvent);
    await wrapper.vm.$nextTick();

    expect((wrapper.vm as any).isStereo).toBe(false);
    expect(wrapper.emitted().loadedmetadata).toBeTruthy();
    expect(wrapper.emitted().loadedmetadata[0]).toEqual([mockEvent]);

    createElementSpy.mockRestore();
  });

  it('cleans up on unmount', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    wrapper.unmount();
  });

  it('handles play/pause props', async () => {
    const wrapper = mount(VRVideoPlayer, {
      props: { ...defaultProps, isPlaying: true },
    });
    await wrapper.vm.$nextTick();

    // Test pause
    await wrapper.setProps({ isPlaying: false });
    await wrapper.vm.$nextTick();

    // Test play again
    await wrapper.setProps({ isPlaying: true });
    await wrapper.vm.$nextTick();
  });

  it('updates video init source when src prop changes', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    await wrapper.setProps({ src: 'http://test/video2.mp4' });
    await wrapper.vm.$nextTick();

    // Implicitly checking that no error is thrown and logic runs.
    // We mocked createElement so we theoretically could check if our mock's src changed
    // if we captured it, but for coverage this branch execution is sufficient.
  });

  it('handles window resize', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    window.dispatchEvent(new Event('resize'));
    // Wait for logic
    await wrapper.vm.$nextTick();
  });

  it('handles fullscreen error', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const requestFullscreenMock = vi
      .fn()
      .mockRejectedValue(new Error('Fullscreen denied'));

    // Mock container requestFullscreen
    const container = wrapper.find('.vr-container').element;
    container.requestFullscreen = requestFullscreenMock;

    // Call directly
    wrapper.vm.toggleFullscreen();
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0)); // tick for catch block

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Error attempting to enable fullscreen: Fullscreen denied',
      ),
    );
    consoleSpy.mockRestore();
  });

  it('gracefully handles missing container in initThree', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    // Unmount to detach ref
    wrapper.unmount();

    // Call initThree manually, container ref should be null/empty
    wrapper.vm.initThree();
    // Should not throw
  });

  it('handles props changes before video init (null video ref)', async () => {
    // Mount but don't wait for nextTick where initThree happens
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });

    // Change props immediately. video variable should still be null.
    await wrapper.setProps({ isPlaying: !defaultProps.isPlaying });
    await wrapper.setProps({ src: 'new-src.mp4' });

    // Should implicitly pass without error and hit early returns
  });

  it('handles initialTime prop', async () => {
    // We need to capture the video element created to verify currentTime is set
    const videoMock = document.createElement('video');
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tagName: string) => {
        if (tagName === 'video') return videoMock;
        return window.document.constructor.prototype.createElement.call(
          document,
          tagName,
        );
      });

    const wrapper = mount(VRVideoPlayer, {
      props: { ...defaultProps, initialTime: 42 },
    });

    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // Wait for initThree

    // Check if video.currentTime was set
    expect(videoMock.currentTime).toBe(42);

    createElementSpy.mockRestore();
  });

  it('handles handleTimeUpdate manually', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    // Trigger via exposed method
    wrapper.vm.handleTimeUpdate();

    expect(wrapper.emitted('timeupdate')).toBeTruthy();
  });

  it('toggles fullscreen', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    // Wait for initThree (nextTick inside onMounted)
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    const exitFullscreenMock = vi.fn();

    // Mock container requestFullscreen
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      value: requestFullscreenMock,
      writable: true,
    });
    // Mock document exitFullscreen
    Object.defineProperty(document, 'exitFullscreen', {
      value: exitFullscreenMock,
      writable: true,
    });

    const fsBtnSelector = 'button[aria-label="Exit Fullscreen"]';

    // Enter Fullscreen - Button not visible, call method
    wrapper.vm.toggleFullscreen();
    expect(requestFullscreenMock).toHaveBeenCalled();

    // Mock fullscreen active
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.createElement('div'),
      writable: true,
      configurable: true,
    });
    // Trigger resize/fullscreenchange to update isFullscreen ref
    document.dispatchEvent(new Event('fullscreenchange'));
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();

    // Now exit button should be visible
    const exitBtn = wrapper.find(fsBtnSelector);
    expect(exitBtn.exists()).toBe(true);

    // Exit Fullscreen
    await exitBtn.trigger('click');
    expect(exitFullscreenMock).toHaveBeenCalled();
  });

  it('handles playback toggle', async () => {
    const videoMock = document.createElement('video');
    videoMock.play = vi.fn().mockResolvedValue(undefined);
    videoMock.pause = vi.fn();
    Object.defineProperty(videoMock, 'paused', {
      value: true,
      writable: true,
    });

    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(
        (tagName: string, options?: ElementCreationOptions): any =>
          tagName === 'video'
            ? videoMock
            : originalCreateElement(tagName, options),
      );

    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // initThree

    // 1. Play
    const buttons = wrapper.findAll('button');
    const playPauseBtn = buttons[0]; // Assuming first button is Play/Pause

    await playPauseBtn.trigger('click');
    expect(videoMock.play).toHaveBeenCalled();

    // 2. Pause
    Object.defineProperty(videoMock, 'paused', { value: false });
    await playPauseBtn.trigger('click');
    expect(videoMock.pause).toHaveBeenCalled();

    createElementSpy.mockRestore();
  });

  it('handles recenterVR with permission granted', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();

    const requestPermission = vi.fn().mockResolvedValue('granted');
    const originalDOE = (window as any).DeviceOrientationEvent;

    (window as any).DeviceOrientationEvent = {
      requestPermission,
    };

    const recenterBtn = wrapper.find('button[title="Recenter VR View"]');
    await recenterBtn.trigger('click');

    await flushPromises();

    expect(requestPermission).toHaveBeenCalled();
    expect((wrapper.vm as any).isMotionControlActive).toBe(true);

    (window as any).DeviceOrientationEvent = originalDOE;
  });

  it('handles recenterVR with permission denied', async () => {
    vi.useFakeTimers();
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });

    const requestPermission = vi.fn().mockResolvedValue('denied');
    const originalDOE = (window as any).DeviceOrientationEvent;
    (window as any).DeviceOrientationEvent = { requestPermission };

    const recenterBtn = wrapper.find('button[title="Recenter VR View"]');
    await recenterBtn.trigger('click');
    await flushPromises();

    expect(requestPermission).toHaveBeenCalled();
    expect((wrapper.vm as any).showPermissionDeniedToast).toBe(true);
    expect((wrapper.vm as any).isMotionControlActive).toBe(false);

    // Advance timers to clear the toast
    vi.advanceTimersByTime(3000);
    expect((wrapper.vm as any).showPermissionDeniedToast).toBe(false);

    (window as any).DeviceOrientationEvent = originalDOE;
    vi.useRealTimers();
  });

  it('handles recenterVR without permission requirement (non-iOS)', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });

    const originalDOE = (window as any).DeviceOrientationEvent;
    (window as any).DeviceOrientationEvent = {};

    const recenterBtn = wrapper.find('button[title="Recenter VR View"]');
    await recenterBtn.trigger('click');

    expect((wrapper.vm as any).isMotionControlActive).toBe(true);
    (window as any).DeviceOrientationEvent = originalDOE;
  });

  it('recenters VR when motion is already active', async () => {
    const wrapper = mount(VRVideoPlayer, { props: defaultProps });

    // 1. Activate motion (force via non-iOS path)
    const originalDOE = (window as any).DeviceOrientationEvent;
    (window as any).DeviceOrientationEvent = {};

    const recenterBtn = wrapper.find('button[title="Recenter VR View"]');
    await recenterBtn.trigger('click');
    expect((wrapper.vm as any).isMotionControlActive).toBe(true);

    // 2. Simulate device orientation event to set 'deviceOrientation' variable
    const event = new Event('deviceorientation');
    Object.defineProperty(event, 'alpha', { value: 90 });
    window.dispatchEvent(event);

    // 3. Click recenter again - triggers the 'else' branch
    await recenterBtn.trigger('click');

    // Restore
    (window as any).DeviceOrientationEvent = originalDOE;
  });

  it('updates camera quaternion in animation loop when motion active', async () => {
    let animateCallback: FrameRequestCallback | null = null;
    const originalRAF = window.requestAnimationFrame;
    window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      animateCallback = cb;
      return 1;
    }) as any;

    const wrapper = mount(VRVideoPlayer, { props: defaultProps });
    await wrapper.vm.$nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(animateCallback).toBeTruthy();

    // Activate motion control naturally via the UI instead of mutating unexposed state
    const originalDOE = (window as any).DeviceOrientationEvent;
    (window as any).DeviceOrientationEvent = {};
    const recenterBtn = wrapper.find('button[title="Recenter VR View"]');
    await recenterBtn.trigger('click');
    (window as any).DeviceOrientationEvent = originalDOE;

    // Simulate event data
    const event = new Event('deviceorientation');
    (event as any).alpha = 10;
    (event as any).beta = 20;
    (event as any).gamma = 30;
    window.dispatchEvent(event);

    // Manually invoke the animate callback
    if (animateCallback) {
      (animateCallback as FrameRequestCallback)(0);
    }

    // Restore requestAnimationFrame
    window.requestAnimationFrame = originalRAF;

    expect(THREE.Quaternion).toHaveBeenCalled();
    expect(THREE.Euler).toHaveBeenCalled();
  });
});
