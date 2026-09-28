import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('three', () => {
  const make = (value: object) =>
    vi.fn(function () {
      return value;
    });
  return {
    Scene: vi.fn(function () {
      return { add: vi.fn(), remove: vi.fn() };
    }),
    PerspectiveCamera: vi.fn(function () {
      return {
        position: { set: vi.fn() },
        aspect: 1,
        updateProjectionMatrix: vi.fn(),
        quaternion: { copy: vi.fn() },
      };
    }),
    WebGLRenderer: vi.fn(function () {
      return {
        setSize: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
        domElement: document.createElement('canvas'),
      };
    }),
    VideoTexture: vi.fn(function () {
      return {
        repeat: { set: vi.fn() },
        offset: { set: vi.fn() },
        dispose: vi.fn(),
      };
    }),
    SphereGeometry: vi.fn(function () {
      return { scale: vi.fn(), dispose: vi.fn() };
    }),
    MeshBasicMaterial: make({ dispose: vi.fn() }),
    Mesh: vi.fn(function () {
      return { rotation: { y: 0 } };
    }),
    SRGBColorSpace: 'SRGB',
    ClampToEdgeWrapping: 1001,
    MathUtils: { degToRad: (deg: number) => (deg * Math.PI) / 180 },
    Euler: vi.fn(function () {
      return { set: vi.fn() };
    }),
    Quaternion: vi.fn(function () {
      return {
        setFromEuler: vi.fn(),
        multiply: vi.fn(),
        setFromAxisAngle: vi.fn().mockReturnThis(),
      };
    }),
    Vector3: vi.fn(),
  };
});

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: vi.fn(function () {
    return {
      target: { set: vi.fn() },
      update: vi.fn(),
      dispose: vi.fn(),
      reset: vi.fn(),
      enabled: true,
    };
  }),
}));

const hlsInstances: any[] = [];
vi.mock('hls.js', () => {
  const MockHls = vi.fn().mockImplementation(function (
    this: any,
    config: unknown,
  ) {
    this.config = config;
    this.handlers = new Map<string, (...args: any[]) => void>();
    this.on = vi.fn((event: string, handler: (...args: any[]) => void) => {
      this.handlers.set(event, handler);
    });
    this.fire = (event: string, data?: unknown) =>
      this.handlers.get(event)?.(event, data);
    this.attachMedia = vi.fn();
    this.loadSource = vi.fn();
    this.destroy = vi.fn();
    this.startLoad = vi.fn();
    this.recoverMediaError = vi.fn();
    this.swapAudioCodec = vi.fn();
    hlsInstances.push(this);
  });
  (MockHls as any).isSupported = vi.fn().mockReturnValue(true);
  (MockHls as any).Events = {
    MEDIA_ATTACHED: 'mediaAttached',
    MANIFEST_PARSED: 'manifestParsed',
    LEVEL_LOADED: 'levelLoaded',
    FRAG_BUFFERED: 'fragBuffered',
    ERROR: 'hlsError',
  };
  (MockHls as any).ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
  };
  return { default: MockHls };
});

import VRVideoPlayer from '@/features/player/VRVideoPlayer.vue';

describe('VRVideoPlayer playback wiring', () => {
  let video: HTMLVideoElement;
  let createElementSpy: ReturnType<typeof vi.spyOn>;

  const mountPlayer = async (props: Record<string, unknown> = {}) => {
    const wrapper = mount(VRVideoPlayer, {
      props: {
        src: 'http://test/video.mp4',
        isPlaying: false,
        initialTime: 0,
        isControlsVisible: true,
        ...props,
      },
    });
    await nextTick();
    await nextTick(); // initThree runs in a nextTick after mount
    return wrapper;
  };

  beforeEach(() => {
    hlsInstances.length = 0;
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    video = document.createElement('video');
    video.play = vi.fn().mockResolvedValue(undefined);
    video.pause = vi.fn();
    video.load = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation(
        (tagName: string, options?: ElementCreationOptions): any =>
          tagName === 'video' ? video : originalCreateElement(tagName, options),
      );
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('plays direct sources without looping and forwards media events', async () => {
    const wrapper = await mountPlayer();
    expect(video.getAttribute('src')).toBe('http://test/video.mp4');
    // 'ended' must reach MediaDisplay (slideshow advance / timer loop).
    expect(video.loop).toBe(false);

    video.dispatchEvent(new Event('playing'));
    video.dispatchEvent(new Event('waiting'));
    video.dispatchEvent(new Event('canplay'));
    video.dispatchEvent(new Event('ended'));
    video.dispatchEvent(new Event('error'));

    expect(wrapper.emitted('playing')).toHaveLength(1);
    const buffering = wrapper.emitted('buffering')!;
    expect(buffering).toContainEqual([true]);
    expect(buffering[buffering.length - 1]).toEqual([false]);
    expect(wrapper.emitted('ended')).toHaveLength(1);
    expect(wrapper.emitted('error')).toHaveLength(1);
    wrapper.unmount();
  });

  it('plays HLS playlists through hls.js from the resume position', async () => {
    const wrapper = await mountPlayer({
      src: '/api/hls/master.m3u8?file=movie.mkv',
      initialTime: 42,
      isPlaying: true,
    });

    expect(hlsInstances).toHaveLength(1);
    const hls = hlsInstances[0];
    expect(hls.attachMedia).toHaveBeenCalledWith(video);
    expect(hls.config.startPosition).toBe(42);
    expect(video.getAttribute('src')).toBeNull();

    hls.fire('manifestParsed');
    expect(video.play).toHaveBeenCalled();

    hls.fire('hlsError', {
      fatal: true,
      type: 'otherError',
      details: 'internalException',
    });
    expect(wrapper.emitted('error')).toHaveLength(1);
    wrapper.unmount();
  });

  it('switches to hls.js on the direct-play -> HLS fallback and drops it again', async () => {
    const wrapper = await mountPlayer();
    await wrapper.setProps({ src: '/api/hls/master.m3u8?file=a.mp4' });
    expect(hlsInstances).toHaveLength(1);

    await wrapper.setProps({ src: '/api/hls/master.m3u8?file=b.mp4' });
    expect(hlsInstances[0].destroy).toHaveBeenCalled();
    expect(hlsInstances).toHaveLength(2);

    await wrapper.setProps({ src: 'http://test/other.mp4' });
    expect(hlsInstances[1].destroy).toHaveBeenCalled();
    expect(video.getAttribute('src')).toBe('http://test/other.mp4');
    wrapper.unmount();
  });

  it('releases hls.js, the source and the parent reference on unmount', async () => {
    const wrapper: VueWrapper<any> = await mountPlayer({
      src: '/api/hls/master.m3u8?file=movie.mkv',
    });
    const hls = hlsInstances[0];
    expect(wrapper.emitted('update:video-element')![0]).toEqual([video]);

    // (VTU clears the recorded events when unmounting.)
    wrapper.unmount();

    expect(hls.destroy).toHaveBeenCalled();
    expect(wrapper.emitted('update:video-element')).toEqual([[null]]);
    expect(video.pause).toHaveBeenCalled();
    expect(video.load).toHaveBeenCalled();

    // Listeners are gone: events queued by the release don't leak out.
    video.dispatchEvent(new Event('pause'));
    video.dispatchEvent(new Event('timeupdate'));
    expect(wrapper.emitted('pause')).toBeFalsy();
    expect(wrapper.emitted('timeupdate')).toBeFalsy();
  });

  it('reset() stops playback and releases the current source', async () => {
    const wrapper: VueWrapper<any> = await mountPlayer({
      src: '/api/hls/master.m3u8?file=movie.mkv',
    });
    const hls = hlsInstances[0];

    wrapper.vm.reset();

    expect(hls.destroy).toHaveBeenCalled();
    expect(video.pause).toHaveBeenCalled();
    expect(video.getAttribute('src')).toBeNull();
    wrapper.unmount();
  });

  it('waits for the manifest before playing, and only if playback is wanted', async () => {
    const wrapper = await mountPlayer({
      src: '/api/hls/master.m3u8?file=movie.mkv',
      isPlaying: false,
    });
    hlsInstances[0].fire('manifestParsed');
    expect(video.play).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('resumes direct sources at the initial time and plays when wanted', async () => {
    const wrapper = await mountPlayer({ initialTime: 12, isPlaying: true });
    expect(video.currentTime).toBe(12);
    expect(video.play).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('assigns HLS playlists directly where hls.js is unsupported (native HLS)', async () => {
    const Hls = (await import('hls.js')).default as any;
    Hls.isSupported.mockReturnValueOnce(false);
    const wrapper = await mountPlayer({ src: '/native.m3u8' });
    expect(hlsInstances).toHaveLength(0);
    expect(video.getAttribute('src')).toBe('/native.m3u8');
    wrapper.unmount();
  });

  it('is safe to reset or unmount before three.js was initialised', () => {
    const wrapper: VueWrapper<any> = mount(VRVideoPlayer, {
      props: { src: 'a.mp4', isPlaying: false, isControlsVisible: true },
    });
    expect(() => wrapper.vm.reset()).not.toThrow();
    expect(() => wrapper.vm.togglePlay()).not.toThrow();
    expect(() => wrapper.unmount()).not.toThrow();
  });

  it('ignores partial orientation readings and only listens once', async () => {
    const wrapper: VueWrapper<any> = await mountPlayer();
    const originalDOE = (window as any).DeviceOrientationEvent;
    (window as any).DeviceOrientationEvent = {};
    const addListener = vi.spyOn(window, 'addEventListener');

    const recenter = wrapper.find('button[title="Recenter VR View"]');
    await recenter.trigger('click');
    await recenter.trigger('click');
    expect(
      addListener.mock.calls.filter((c) => c[0] === 'deviceorientation'),
    ).toHaveLength(1);

    const partial = new Event('deviceorientation');
    Object.defineProperty(partial, 'alpha', { value: 10 });
    Object.defineProperty(partial, 'beta', { value: null });
    Object.defineProperty(partial, 'gamma', { value: 5 });
    window.dispatchEvent(partial);
    expect(wrapper.vm.isMotionControlActive).toBe(false);

    (window as any).DeviceOrientationEvent = originalDOE;
    wrapper.unmount();
  });

  it('togglePlay plays and pauses its own video', async () => {
    const wrapper: VueWrapper<any> = await mountPlayer();
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    wrapper.vm.togglePlay();
    expect(video.play).toHaveBeenCalled();

    Object.defineProperty(video, 'paused', {
      value: false,
      configurable: true,
    });
    wrapper.vm.togglePlay();
    expect(video.pause).toHaveBeenCalled();
    (video.play as Mock).mockClear();
    wrapper.unmount();
  });
});
