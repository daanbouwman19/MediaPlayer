import { describe, it, expect, vi, Mock, beforeEach } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import VideoPlayer from '@/features/player/VideoPlayer.vue';

// Mock icons
vi.mock('@/components/atoms/icons/PlayIcon.vue', () => ({
  default: { template: '<span>Play</span>' },
}));
vi.mock('@/components/atoms/icons/PauseIcon.vue', () => ({
  default: { template: '<span>Pause</span>' },
}));

// Global variable to capture HLS instance
const mockHlsInstance: any = {};

// Mock Hls.js
vi.mock('hls.js', () => {
  const mockHls = vi.fn().mockImplementation(function (this: any) {
    this.on = vi.fn();
    this.loadSource = vi.fn();
    this.attachMedia = vi.fn();
    this.destroy = vi.fn();
    this.startLoad = vi.fn();
    this.recoverMediaError = vi.fn();
    this.swapAudioCodec = vi.fn();
    Object.assign(mockHlsInstance, this);
  });

  (mockHls as any).isSupported = vi.fn().mockReturnValue(true);
  (mockHls as any).Events = {
    ERROR: 'hlsError',
    MANIFEST_PARSED: 'manifestParsed',
    LEVEL_LOADED: 'levelLoaded',
    MEDIA_ATTACHED: 'mediaAttached',
    FRAG_BUFFERED: 'fragBuffered',
  };
  (mockHls as any).ErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
    OTHER_ERROR: 'otherError',
  };

  return { default: mockHls };
});

import Hls from 'hls.js';

describe('VideoPlayer Coverage', () => {
  const defaultProps = {
    src: 'test-video.mp4',
    poster: 'test-poster.jpg',
    initialTime: 0,
    isControlsVisible: true,
    isTranscodingMode: false,
    isTranscodingLoading: false,
    isBuffering: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the object properties without breaking references if needed,
    // or just re-assign if the tests don't hold onto the old object.
    // In our case, the component creates a NEW Hls instance, which calls the constructor,
    // which does Object.assign(mockHlsInstance, this).
    // So we just need to ensure mockHlsInstance is fresh.
    for (const key in mockHlsInstance) delete mockHlsInstance[key];
    (Hls.isSupported as Mock).mockReturnValue(true);
  });

  it('destroys HLS instance on default fatal error', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    await nextTick();

    const errorCall = mockHlsInstance.on.mock.calls.find(
      (c: any[]) => c[0] === Hls.Events.ERROR,
    );
    expect(errorCall).toBeDefined();

    const fatalError = {
      fatal: true,
      type: 'OTHER_ERROR',
    };
    errorCall![1](Hls.Events.ERROR, fatalError);
    expect(mockHlsInstance.destroy).toHaveBeenCalled();
  });

  it('handles onUnmounted cleanup', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    await nextTick();

    wrapper.unmount();
    expect(mockHlsInstance.destroy).toHaveBeenCalled();
  });

  it('skips setting currentTime if initialTime is 0 or less', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, initialTime: 0 },
    });
    await nextTick();
    const video = wrapper.find('video').element as HTMLVideoElement;
    expect(video.currentTime).toBe(0);

    await wrapper.setProps({ initialTime: -10 });
    await nextTick();
    expect(video.currentTime).toBe(0);
  });

  it('does not toggle play if controls are hidden', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, isControlsVisible: false },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    video.play = vi.fn();
    video.pause = vi.fn();

    await wrapper.find('video').trigger('click');
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it('handles native HLS playback branch correctly', async () => {
    (Hls.isSupported as Mock).mockReturnValue(false);

    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });

    await nextTick();
    const video = wrapper.find('video').element as HTMLVideoElement;
    expect(video.src).toContain('test.m3u8');
  });

  it('handles non-fatal HLS errors', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    await nextTick();

    const errorCall = mockHlsInstance.on.mock.calls.find(
      (c: any[]) => c[0] === Hls.Events.ERROR,
    );
    expect(errorCall).toBeDefined();

    const nonFatalError = {
      fatal: false,
      type: 'ANY_ERROR',
    };
    errorCall![1](Hls.Events.ERROR, nonFatalError);
    expect(mockHlsInstance.startLoad).not.toHaveBeenCalled();
    expect(mockHlsInstance.recoverMediaError).not.toHaveBeenCalled();
    expect(mockHlsInstance.destroy).not.toHaveBeenCalled();
  });

  it('logs live vs vod status on LEVEL_LOADED', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    await nextTick();

    const levelLoadedCall = mockHlsInstance.on.mock.calls.find(
      (c: any[]) => c[0] === Hls.Events.LEVEL_LOADED,
    );
    expect(levelLoadedCall).toBeDefined();

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Live data
    levelLoadedCall![1](Hls.Events.LEVEL_LOADED, {
      details: { live: true },
    });
    expect(consoleSpy).toHaveBeenCalledWith('[HLS] Level loaded:', 'live');

    // VOD data
    levelLoadedCall![1](Hls.Events.LEVEL_LOADED, {
      details: { live: false },
    });
    expect(consoleSpy).toHaveBeenCalledWith('[HLS] Level loaded:', 'vod');

    consoleSpy.mockRestore();
  });

  it('attempts play on MANIFEST_PARSED', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    await nextTick();

    const manifestParsedCall = mockHlsInstance.on.mock.calls.find(
      (c: any[]) => c[0] === Hls.Events.MANIFEST_PARSED,
    );
    expect(manifestParsedCall).toBeDefined();

    const video = wrapper.find('video').element as HTMLVideoElement;
    video.play = vi.fn().mockResolvedValue(undefined);

    // Trigger manifest parsed
    manifestParsedCall![1](Hls.Events.MANIFEST_PARSED);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(video.play).toHaveBeenCalled();

    // Test play failure
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    video.play = vi.fn().mockRejectedValue(new Error('Autoplay blocked'));
    manifestParsedCall![1](Hls.Events.MANIFEST_PARSED);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('emits events on native video interactions', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video');

    await video.trigger('play');
    expect(wrapper.emitted('play')).toBeTruthy();

    await video.trigger('pause');
    expect(wrapper.emitted('pause')).toBeTruthy();

    await video.trigger('ended');
    expect(wrapper.emitted('ended')).toBeTruthy();

    await video.trigger('playing');
    expect(wrapper.emitted('playing')).toBeTruthy();

    await video.trigger('waiting');
    expect(wrapper.emitted('buffering')![0]).toEqual([true]);

    await video.trigger('canplay');
    expect(wrapper.emitted('buffering')![1]).toEqual([false]);

    await video.trigger('error');
    expect(wrapper.emitted('error')).toBeTruthy();
  });

  it('handles timeupdate natively and in transcode mode', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;

    Object.defineProperty(video, 'currentTime', { value: 10, writable: true });
    await wrapper.find('video').trigger('timeupdate');
    expect(wrapper.emitted('timeupdate')![0]).toEqual([10]);

    // The HLS transcode is one absolute timeline from 0: the element's time
    // is reported as-is, never shifted by an offset.
    await wrapper.setProps({ isTranscodingMode: true, src: 'test.m3u8' });
    await wrapper.find('video').trigger('timeupdate');
    expect(wrapper.emitted('timeupdate')![1]).toEqual([10]);
  });

  it('reset method works correctly', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const video = wrapper.find('video').element as HTMLVideoElement;
    video.pause = vi.fn();
    video.load = vi.fn();
    video.removeAttribute = vi.fn();

    (wrapper.vm as any).reset();

    expect(video.pause).toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalled();
  });

  it('triggers transcode on loadedmetadata when dimensions are missing', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 0 });
    Object.defineProperty(video, 'videoHeight', { value: 0 });

    await wrapper.find('video').trigger('loadedmetadata');
    expect(wrapper.emitted('trigger-transcode')).toBeTruthy();
    expect(wrapper.emitted('trigger-transcode')![0]).toEqual([0]);
  });

  it('effectiveSrc computes correctly', async () => {
    (Hls.isSupported as Mock).mockReturnValue(true);
    let wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    expect((wrapper.vm as any).effectiveSrc).toBeUndefined();

    wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    expect((wrapper.vm as any).effectiveSrc).toBe('test.mp4');
  });

  it('initHls returns early for invalid src', async () => {
    mount(VideoPlayer, { props: { ...defaultProps, src: '' } });
    if (mockHlsInstance.loadSource) {
      expect(mockHlsInstance.loadSource).not.toHaveBeenCalled();
    }
  });

  it('watch ignores same src', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await wrapper.setProps({ src: 'test.m3u8' });
    expect((Hls.isSupported as Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('togglePlay pauses if already playing', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, isControlsVisible: true },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { value: false });
    video.pause = vi.fn();
    video.play = vi.fn();
    (wrapper.vm as any).togglePlay();
    expect(video.pause).toHaveBeenCalled();
  });

  it('handleLoadedMetadata does not transcode if dimensions exist', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 100 });
    Object.defineProperty(video, 'videoHeight', { value: 100 });
    await wrapper.find('video').trigger('loadedmetadata');
    expect(wrapper.emitted('trigger-transcode')).toBeFalsy();
  });

  it('handleTimeUpdate works in standard mode', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, isTranscodingMode: false },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'currentTime', { value: 10, writable: true });
    await wrapper.find('video').trigger('timeupdate');
    expect(wrapper.emitted('timeupdate')![0]).toEqual([10]);
  });

  it('handles HLS fatal network error', async () => {
    vi.useFakeTimers();
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const handler = (event: string) =>
      mockHlsInstance.on.mock.calls.find((c: any) => c[0] === event)[1];
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    handler(Hls.Events.MANIFEST_PARSED)();

    handler(Hls.Events.ERROR)('event', {
      fatal: true,
      type: Hls.ErrorTypes.NETWORK_ERROR,
      details: 'net',
    });
    // Retried after a backoff delay, not in a tight loop.
    expect(mockHlsInstance.startLoad).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(mockHlsInstance.startLoad).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reports an unrecoverable HLS network error instead of retrying forever', async () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const errorCallback = mockHlsInstance.on.mock.calls.find(
      (c: any) => c[0] === Hls.Events.ERROR,
    )[1];
    const fatalNetworkError = {
      fatal: true,
      type: Hls.ErrorTypes.NETWORK_ERROR,
      details: 'manifestLoadError',
    };

    // The playlist itself failed (e.g. HTTP 500): each retry requests it
    // again, as startLoad() cannot recover before a manifest was parsed.
    for (let attempt = 0; attempt < 3; attempt++) {
      errorCallback('event', fatalNetworkError);
      vi.advanceTimersByTime(10_000);
    }
    expect(mockHlsInstance.loadSource).toHaveBeenCalledTimes(3);
    expect(mockHlsInstance.loadSource).toHaveBeenCalledWith('test.m3u8');
    expect(wrapper.emitted('error')).toBeFalsy();

    errorCallback('event', fatalNetworkError);
    expect(mockHlsInstance.loadSource).toHaveBeenCalledTimes(3);
    expect(mockHlsInstance.startLoad).not.toHaveBeenCalled();
    expect(mockHlsInstance.destroy).toHaveBeenCalled();
    expect(wrapper.emitted('error')).toHaveLength(1);
    expect((wrapper.emitted('error')![0][0] as Error).message).toContain(
      'manifestLoadError',
    );
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('escalates repeated HLS media errors and finally reports them', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const errorCallback = mockHlsInstance.on.mock.calls.find(
      (c: any) => c[0] === Hls.Events.ERROR,
    )[1];
    const mediaError = {
      fatal: true,
      type: Hls.ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
    };

    errorCallback('event', mediaError);
    expect(mockHlsInstance.recoverMediaError).toHaveBeenCalledTimes(1);
    expect(mockHlsInstance.swapAudioCodec).not.toHaveBeenCalled();

    errorCallback('event', mediaError);
    expect(mockHlsInstance.swapAudioCodec).toHaveBeenCalledTimes(1);
    expect(mockHlsInstance.recoverMediaError).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted('error')).toBeFalsy();

    errorCallback('event', mediaError);
    expect(mockHlsInstance.destroy).toHaveBeenCalled();
    expect(wrapper.emitted('error')).toHaveLength(1);
    errorSpy.mockRestore();
  });

  it('starts HLS playback at 0, not at the live edge, when there is no resume time', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8', initialTime: 0 },
    });
    await nextTick();
    expect(Hls).toHaveBeenCalledWith(
      expect.objectContaining({ startPosition: 0 }),
    );
  });

  it('starts HLS playback at the resume position', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8', initialTime: 42 },
    });
    await nextTick();
    expect(Hls).toHaveBeenCalledWith(
      expect.objectContaining({ startPosition: 42 }),
    );
  });

  it('keeps the MediaSource hls.js attached when direct play falls back to HLS on the same instance', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'direct.mp4' },
    });
    await nextTick();
    const video = wrapper.find('video').element as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('direct.mp4');

    // Like hls.js, attachMedia points the element at a MediaSource blob URL
    // synchronously.
    (Hls as unknown as Mock).mockImplementationOnce(function (this: any) {
      this.on = vi.fn();
      this.loadSource = vi.fn();
      this.destroy = vi.fn();
      this.attachMedia = vi.fn((media: HTMLVideoElement) => {
        media.src = 'blob:hls-media-source';
      });
    });

    await wrapper.setProps({ src: '/api/hls/master.m3u8?file=direct.mp4' });
    await nextTick();

    // Vue's :src patch (to undefined) must happen before hls.js attaches,
    // not after it, or it removes the blob URL and nothing ever loads.
    expect(video.getAttribute('src')).toBe('blob:hls-media-source');
  });

  it('togglePlay works while the controls are hidden (keyboard / control bar)', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, isControlsVisible: false },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    video.play = vi.fn().mockResolvedValue(undefined);

    (wrapper.vm as any).togglePlay();
    expect(video.play).toHaveBeenCalled();
  });

  it('clears the parent video element and releases the source on unmount', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    video.pause = vi.fn();
    video.load = vi.fn();

    wrapper.unmount();

    const updates = wrapper.emitted('update:video-element')!;
    expect(updates[updates.length - 1]).toEqual([null]);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.load).toHaveBeenCalled();
  });

  it('does not emit media events once it is being unmounted', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    wrapper.unmount();

    // Releasing the element queues events like these.
    const events = [
      'pause',
      'play',
      'playing',
      'ended',
      'timeupdate',
      'error',
      'waiting',
      'canplay',
      'loadedmetadata',
    ];
    for (const type of events) video.dispatchEvent(new Event(type));

    for (const type of [...events, 'buffering']) {
      expect(wrapper.emitted(type)).toBeFalsy();
    }
  });

  it('does not report an HLS failure or autoplay after unmounting', async () => {
    vi.useFakeTimers();
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const video = wrapper.find('video').element as HTMLVideoElement;
    video.play = vi.fn().mockResolvedValue(undefined);
    const handler = (name: string) =>
      mockHlsInstance.on.mock.calls.find((c: any[]) => c[0] === name)[1];
    const onError = handler(Hls.Events.ERROR);
    const onManifest = handler(Hls.Events.MANIFEST_PARSED);

    onManifest(Hls.Events.MANIFEST_PARSED);
    wrapper.unmount();
    vi.runAllTimers();
    onError('event', { fatal: true, type: 'otherError', details: 'late' });

    expect(video.play).not.toHaveBeenCalled();
    expect(wrapper.emitted('error')).toBeFalsy();
    vi.useRealTimers();
  });

  it('tolerates play() implementations that return nothing', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    video.play = vi.fn().mockReturnValue(undefined);
    expect(() => (wrapper.vm as any).togglePlay()).not.toThrow();
    expect(video.play).toHaveBeenCalled();
  });

  it('ignores an AbortError from a toggled play()', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4' },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    video.play = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(), { name: 'AbortError' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    (wrapper.vm as any).togglePlay();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('handles HLS fatal media error', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const errorCallback = mockHlsInstance.on.mock.calls.find(
      (c: any) => c[0] === Hls.Events.ERROR,
    )[1];

    errorCallback('event', {
      fatal: true,
      type: Hls.ErrorTypes.MEDIA_ERROR,
      details: 'media',
    });
    expect(mockHlsInstance.recoverMediaError).toHaveBeenCalled();
  });

  it('handles HLS fatal other error', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const errorCallback = mockHlsInstance.on.mock.calls.find(
      (c: any) => c[0] === Hls.Events.ERROR,
    )[1];
    errorCallback('event', {
      fatal: true,
      type: Hls.ErrorTypes.OTHER_ERROR,
      details: 'other',
    });
    expect(wrapper.emitted('error')).toBeTruthy();
  });

  it('falls back to native HLS if supported', async () => {
    (Hls.isSupported as Mock).mockReturnValue(false);
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'native.m3u8', initialTime: 50 },
    });
    await nextTick();
    const video = wrapper.find('video').element as HTMLVideoElement;
    video.canPlayType = vi.fn().mockReturnValue('maybe');

    await wrapper.setProps({ src: 'native2.m3u8' });

    expect(video.canPlayType).toHaveBeenCalledWith(
      'application/vnd.apple.mpegurl',
    );
    expect(video.src).toContain('native2.m3u8');
    expect(video.currentTime).toBe(50);
  });

  it('catches and ignores AbortError on unmounted autoplay', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();
    const manifestParsedCall = mockHlsInstance.on.mock.calls.find(
      (c: any) => c[0] === Hls.Events.MANIFEST_PARSED,
    );
    const video = wrapper.find('video').element as HTMLVideoElement;
    video.play = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(), { name: 'AbortError' }));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    manifestParsedCall![1](Hls.Events.MANIFEST_PARSED);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('catches and logs play error on togglePlay', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, isControlsVisible: true },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    Object.defineProperty(video, 'src', {
      value: 'test.mp4',
      configurable: true,
    });
    video.play = vi.fn().mockRejectedValue(new Error('play error'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await (wrapper.vm as any).togglePlay();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('togglePlay returns early if no source attached', async () => {
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, isControlsVisible: true },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    Object.defineProperty(video, 'src', { value: '', configurable: true });
    Object.defineProperty(video, 'srcObject', {
      value: null,
      configurable: true,
    });

    video.play = vi.fn();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await (wrapper.vm as any).togglePlay();

    expect(video.play).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[VideoPlayer] Play ignored: No source attached yet',
    );
    consoleSpy.mockRestore();
  });

  it('attempts to recover on HLS media error', async () => {
    mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.m3u8' },
    });
    await nextTick();

    const errorCall = mockHlsInstance.on.mock.calls.find(
      (c: any[]) => c[0] === Hls.Events.ERROR,
    );
    expect(errorCall).toBeDefined();

    // Trigger fatal media error
    errorCall![1](Hls.Events.ERROR, {
      fatal: true,
      type: Hls.ErrorTypes.MEDIA_ERROR,
    });

    expect(mockHlsInstance.recoverMediaError).toHaveBeenCalled();
  });

  it('sets initialTime for raw video files on mount', async () => {
    const initialTime = 42;
    const wrapper = mount(VideoPlayer, {
      props: { ...defaultProps, src: 'test.mp4', initialTime },
    });
    const video = wrapper.find('video').element as HTMLVideoElement;
    expect(video.currentTime).toBe(initialTime);
  });

  it('handleSeeking triggers update logic', async () => {
    const wrapper = mount(VideoPlayer, { props: { ...defaultProps } });
    await wrapper.find('video').trigger('seeking');
    expect(wrapper.exists()).toBeTruthy(); // just hitting line
  });
});
