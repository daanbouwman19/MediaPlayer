/**
 * Integration tests for MediaDisplay with the real transcoder, media loader,
 * VideoPlayer, MediaControls and ProgressBar. Only the backend API, the
 * slideshow/toast composables, hls.js and the (three.js) VR player are faked.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';

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

const vrTogglePlay = vi.fn();
vi.mock('@/features/player/VRVideoPlayer.vue', () => ({
  __esModule: true,
  __isTeleport: false,
  __isKeepAlive: false,
  __asyncLoader: undefined,
  __asyncResolved: undefined,
  default: {
    name: 'VRVideoPlayer',
    template: '<div class="vr-video-player-mock"></div>',
    props: ['src', 'poster', 'isPlaying', 'initialTime', 'isControlsVisible'],
    emits: [
      'timeupdate',
      'update:video-element',
      'play',
      'pause',
      'playing',
      'ended',
      'error',
      'buffering',
      'loadedmetadata',
    ],
    setup() {
      return {
        togglePlay: vrTogglePlay,
        toggleFullscreen: vi.fn(),
        reset: vi.fn(),
      };
    },
  },
}));

vi.mock('@/api');
vi.mock('@/composables/useSlideshow');
vi.mock('@/composables/useToast');

import MediaDisplay from '@/features/player/MediaDisplay.vue';
import MediaControls from '@/features/player/MediaControls.vue';
import VideoPlayer from '@/features/player/VideoPlayer.vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useToast } from '@/composables/useToast';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { usePlaylistStore } from '@/composables/usePlaylistStore';
import { useUIStore } from '@/composables/useUIStore';
import { api } from '@/api';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const item = (name: string, extra: Record<string, unknown> = {}) =>
  ({ name, path: `/lib/${name}`, ...extra }) as any;

const HLS_URL = '/api/hls/master.m3u8?file=%2Flib%2Fmovie.mkv';

describe('MediaDisplay playback (integration)', () => {
  let slideshow: Record<string, Mock>;
  let toast: Record<string, Mock>;
  let wrapper: VueWrapper<any> | null = null;
  let metadata: Record<string, Record<string, unknown>>;

  const mountDisplay = async () => {
    wrapper = mount(MediaDisplay);
    await settle();
    return wrapper;
  };

  const settle = async () => {
    await flushPromises();
    await nextTick();
    await flushPromises();
  };

  const video = () => wrapper!.find('video').element as HTMLVideoElement;
  const controls = () => wrapper!.findComponent(MediaControls);

  const setVideoTime = (el: HTMLVideoElement, time: number) => {
    el.currentTime = time;
    el.dispatchEvent(new Event('timeupdate'));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hlsInstances.length = 0;
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});

    const library = useLibraryStore();
    library.supportedExtensions = {
      images: ['.jpg'],
      videos: ['.mp4', '.mkv'],
      all: ['.jpg', '.mp4', '.mkv'],
    };
    library.mediaDirectories = [{ path: '/lib' }] as any;
    library.mediaUrlGenerator = (path: string) => `media://${path}`;

    const player = usePlayerStore();
    player.isTimerRunning = false;
    player.isTimerPausedForVideo = false;
    player.pauseTimerOnPlay = false;
    player.timerDuration = 30;
    player.mainVideoElement = null;

    usePlaylistStore().currentItem = null;
    useUIStore().isControlsVisible = true;

    slideshow = {
      navigateMedia: vi.fn(),
      pauseSlideshowTimerForVideo: vi.fn(() => {
        const player = usePlayerStore();
        if (!player.isTimerRunning) return;
        player.isTimerPausedForVideo = true;
        player.isTimerRunning = false;
      }),
      resumeSlideshowTimerAfterVideo: vi.fn(() => {
        const player = usePlayerStore();
        if (!player.isTimerPausedForVideo) return;
        player.isTimerPausedForVideo = false;
        player.isTimerRunning = true;
      }),
      toggleSlideshowTimer: vi.fn(),
    };
    (useSlideshow as Mock).mockReturnValue(slideshow);
    toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
    (useToast as Mock).mockReturnValue(toast);

    metadata = {};
    (api.getMetadata as Mock).mockImplementation(async (paths: string[]) => {
      const result: Record<string, unknown> = {};
      for (const p of paths) if (metadata[p]) result[p] = metadata[p];
      return result;
    });
    (api.getHlsUrl as Mock).mockResolvedValue(HLS_URL);
    (api.getHlsStatus as Mock).mockResolvedValue({
      percent: 10,
      duration: 0,
      currentTime: 0,
    });
    (api.getVideoMetadata as Mock).mockRejectedValue(new Error('no probe'));
    (api.updatePlaybackPosition as Mock).mockResolvedValue(undefined);
    (api.updateWatchedSegments as Mock).mockResolvedValue(undefined);
    (api.getHeatmap as Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('transcoded (HLS) playback', () => {
    it('seeks natively without restarting the transcode and reports absolute times', async () => {
      (api.getVideoMetadata as Mock).mockResolvedValue({ duration: 600 });
      usePlaylistStore().currentItem = item('movie.mkv');
      await mountDisplay();

      const el = video();
      expect(hlsInstances).toHaveLength(1);
      el.dispatchEvent(new Event('playing'));
      await nextTick();

      controls().vm.$emit('seek', 120);
      await settle();

      expect(el.currentTime).toBe(120);
      expect(api.getHlsUrl).toHaveBeenCalledTimes(1);
      expect(hlsInstances).toHaveLength(1);
      expect(wrapper!.text()).not.toContain('Transcoding...');

      // The element's time is already absolute: no offset is added.
      el.dispatchEvent(new Event('play'));
      setVideoTime(el, 120);
      await nextTick();
      expect(controls().props('currentTime')).toBe(120);
      expect(controls().props('duration')).toBe(600);

      // Arrow keys seek the same way.
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'ArrowRight' }),
      );
      expect(el.currentTime).toBe(125);
      expect(api.getHlsUrl).toHaveBeenCalledTimes(1);
    });

    it('starts from 0 instead of the live edge', async () => {
      usePlaylistStore().currentItem = item('movie.mkv');
      await mountDisplay();
      expect(hlsInstances[0].config.startPosition).toBe(0);
    });

    it('takes the full duration from the library and pauses the timer for a long video', async () => {
      metadata['/lib/movie.mkv'] = { duration: 5400 };
      usePlayerStore().isTimerRunning = true;
      usePlaylistStore().currentItem = item('movie.mkv');
      await mountDisplay();

      expect(controls().props('duration')).toBe(5400);
      expect(api.getVideoMetadata).not.toHaveBeenCalled();
      video().dispatchEvent(new Event('play'));
      expect(slideshow.pauseSlideshowTimerForVideo).toHaveBeenCalled();
    });

    it('pauses the timer once a late duration shows the video is long', async () => {
      const probe = deferred<{ duration: number }>();
      (api.getVideoMetadata as Mock).mockReturnValue(probe.promise);
      usePlayerStore().isTimerRunning = true;
      usePlaylistStore().currentItem = item('movie.mkv');
      await mountDisplay();

      // Only the growing live playlist is known when playback starts.
      video().dispatchEvent(new Event('play'));
      expect(slideshow.pauseSlideshowTimerForVideo).not.toHaveBeenCalled();

      probe.resolve({ duration: 7200 });
      await settle();
      expect(slideshow.pauseSlideshowTimerForVideo).toHaveBeenCalled();
      expect(controls().props('duration')).toBe(7200);
    });

    it('offers VLC when the HLS transcode fails too, and can retry', async () => {
      usePlaylistStore().currentItem = item('movie.mkv');
      await mountDisplay();
      expect(wrapper!.text()).toContain('Transcoding...');

      hlsInstances[0].fire('hlsError', {
        fatal: true,
        type: 'otherError',
        details: 'internalException',
      });
      await settle();

      expect(wrapper!.text()).toContain('Video Format Not Supported');
      expect(wrapper!.text()).toContain('Open in VLC');
      expect(wrapper!.text()).not.toContain('Transcoding...');
      expect(wrapper!.find('video').exists()).toBe(false);

      const retry = wrapper!
        .findAll('button')
        .find((b) => b.text() === 'Try Transcoding')!;
      await retry.trigger('click');
      await settle();
      expect(api.getHlsUrl).toHaveBeenCalledTimes(2);
      expect(wrapper!.find('video').exists()).toBe(true);
    });

    it('falls back from direct play to HLS on the same player', async () => {
      usePlaylistStore().currentItem = item('hevc.mp4');
      await mountDisplay();
      const el = video();
      expect(el.getAttribute('src')).toBe('media:///lib/hevc.mp4');

      el.dispatchEvent(new Event('error'));
      await settle();

      expect(api.getHlsUrl).toHaveBeenCalledWith('/lib/hevc.mp4');
      expect(hlsInstances).toHaveLength(1);
      expect(hlsInstances[0].attachMedia).toHaveBeenCalledWith(video());
    });
  });

  describe('switching items', () => {
    it("saves the previous video's final position under its own path", async () => {
      metadata['/lib/b.mp4'] = { playbackPosition: 30, duration: 1000 };
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();

      const el = video();
      el.dispatchEvent(new Event('play'));
      setVideoTime(el, 600);
      (api.updatePlaybackPosition as Mock).mockClear();

      usePlaylistStore().currentItem = item('b.mp4');
      await settle();

      expect(api.updatePlaybackPosition).toHaveBeenCalledWith(
        '/lib/a.mp4',
        600,
      );
      expect(api.updatePlaybackPosition).not.toHaveBeenCalledWith(
        '/lib/b.mp4',
        600,
      );
      // B resumes at its own saved position, not at A's.
      expect(controls().props('currentTime')).toBe(30);
      expect(wrapper!.findComponent(VideoPlayer).props('initialTime')).toBe(30);
    });

    it('waits for pending writes of a file before reading its metadata back', async () => {
      const write = deferred<void>();
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      const el = video();
      el.dispatchEvent(new Event('play'));
      setVideoTime(el, 42);

      (api.updatePlaybackPosition as Mock).mockReturnValue(write.promise);
      (api.getMetadata as Mock).mockClear();
      // Reopen the same file (e.g. "previous" after "next").
      usePlaylistStore().currentItem = item('a.mp4');
      await settle();
      expect(api.getMetadata).not.toHaveBeenCalled();

      write.resolve();
      await settle();
      expect(api.getMetadata).toHaveBeenCalledWith(['/lib/a.mp4']);
    });

    it('still loads a file when its pending write never settles', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      const el = video();
      el.dispatchEvent(new Event('play'));
      setVideoTime(el, 42);

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        // A stalled request: the write never resolves.
        (api.updatePlaybackPosition as Mock).mockReturnValue(
          new Promise<void>(() => {}),
        );
        (api.getMetadata as Mock).mockClear();
        usePlaylistStore().currentItem = item('a.mp4');
        await settle();
        expect(api.getMetadata).not.toHaveBeenCalled();
        expect(wrapper!.find('video').exists()).toBe(false);

        await vi.advanceTimersByTimeAsync(2000);
        await settle();
      } finally {
        vi.useRealTimers();
      }
      expect(api.getMetadata).toHaveBeenCalledWith(['/lib/a.mp4']);
      expect(video().getAttribute('src')).toBe('media:///lib/a.mp4');
    });

    it('keeps watched segments per file and saves them under the right path', async () => {
      const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
      metadata['/lib/a.mp4'] = {
        watchedSegments: JSON.stringify([{ start: 0, end: 5 }]),
      };
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      expect(controls().props('watchedSegments')).toEqual([
        { start: 0, end: 5 },
      ]);

      const elA = video();
      elA.dispatchEvent(new Event('play'));
      setVideoTime(elA, 10);
      setVideoTime(elA, 12);
      (api.updateWatchedSegments as Mock).mockClear();

      usePlaylistStore().currentItem = item('b.mp4');
      await settle();

      expect(api.updateWatchedSegments).toHaveBeenCalledWith(
        '/lib/a.mp4',
        JSON.stringify([
          { start: 0, end: 5 },
          { start: 10, end: 12 },
        ]),
      );
      // B was never watched: nothing of A's list is shown or saved for it.
      expect(controls().props('watchedSegments')).toEqual([]);

      const elB = video();
      elB.dispatchEvent(new Event('play'));
      setVideoTime(elB, 1);
      now.mockReturnValue(1_010_000);
      setVideoTime(elB, 3);
      expect(api.updateWatchedSegments).toHaveBeenLastCalledWith(
        '/lib/b.mp4',
        JSON.stringify([{ start: 1, end: 3 }]),
      );
    });

    it('does not save segments before the stored ones were loaded', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      const metaB = deferred<Record<string, unknown>>();
      (api.getMetadata as Mock).mockReturnValue(metaB.promise);

      usePlaylistStore().currentItem = item('b.mp4');
      await settle();
      (wrapper!.vm as any).addWatchedSegment(1, 2);
      await (wrapper!.vm as any).persistWatchedSegments('/lib/b.mp4');
      expect(api.updateWatchedSegments).not.toHaveBeenCalled();

      metaB.resolve({});
      await settle();
    });

    it("never plays the next item with the previous item's URL while its metadata loads", async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      expect(video().getAttribute('src')).toBe('media:///lib/a.mp4');
      const metaB = deferred<Record<string, unknown>>();
      (api.getMetadata as Mock).mockReturnValue(metaB.promise);

      usePlaylistStore().currentItem = item('b.mp4');
      await settle();
      expect(wrapper!.find('video').exists()).toBe(false);
      expect(api.updatePlaybackPosition).not.toHaveBeenCalledWith(
        '/lib/b.mp4',
        expect.anything(),
      );

      metaB.resolve({});
      await settle();
      expect(video().getAttribute('src')).toBe('media:///lib/b.mp4');
    });

    it('clears the shared video element when switching to an image', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      expect(usePlayerStore().mainVideoElement).toBe(video());

      usePlaylistStore().currentItem = item('photo.jpg');
      await settle();
      expect(usePlayerStore().mainVideoElement).toBeNull();
    });
  });

  describe('slideshow timer', () => {
    it('advances instead of looping when a video ends with "pause timer on play"', async () => {
      const player = usePlayerStore();
      player.pauseTimerOnPlay = true;
      player.isTimerRunning = true;
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();

      const el = video();
      el.dispatchEvent(new Event('play'));
      expect(slideshow.pauseSlideshowTimerForVideo).toHaveBeenCalled();
      (HTMLMediaElement.prototype.play as Mock).mockClear();

      // End of playback: 'pause' then 'ended' in the same task. The pause
      // resumes the countdown, which must not be mistaken for "the video is
      // shorter than the timer" (that would replay it forever).
      el.currentTime = 42;
      Object.defineProperty(el, 'ended', { value: true, configurable: true });
      el.dispatchEvent(new Event('pause'));
      expect(player.isTimerRunning).toBe(true);
      el.dispatchEvent(new Event('ended'));

      expect(slideshow.navigateMedia).toHaveBeenCalledWith(1);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
      expect(el.currentTime).not.toBe(0);
    });

    it('still resumes the timer when the user pauses mid-video', async () => {
      const player = usePlayerStore();
      player.pauseTimerOnPlay = true;
      player.isTimerRunning = true;
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();

      const el = video();
      el.dispatchEvent(new Event('play'));
      el.dispatchEvent(new Event('pause'));
      expect(slideshow.resumeSlideshowTimerAfterVideo).toHaveBeenCalled();
    });

    it("finishes the playing video's state when switching items", async () => {
      const player = usePlayerStore();
      player.pauseTimerOnPlay = true;
      player.isTimerRunning = true;
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();

      video().dispatchEvent(new Event('play'));
      await settle();
      expect(slideshow.pauseSlideshowTimerForVideo).toHaveBeenCalled();
      expect(controls().props('isPlaying')).toBe(true);

      // The old player unmounts in the same flush, so its 'pause' never
      // arrives: the switch itself must stop playback and resume the timer.
      usePlaylistStore().currentItem = item('b.mp4');
      await settle();
      expect(controls().props('isPlaying')).toBe(false);
      expect(slideshow.resumeSlideshowTimerAfterVideo).toHaveBeenCalled();
      expect(player.isTimerRunning).toBe(true);
    });

    it('does not restart a user-paused countdown when switching items mid-video', async () => {
      const player = usePlayerStore();
      player.pauseTimerOnPlay = true;
      player.isTimerRunning = false;
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();

      video().dispatchEvent(new Event('play'));
      await settle();
      expect(controls().props('isPlaying')).toBe(true);

      usePlaylistStore().currentItem = item('b.mp4');
      await settle();
      expect(controls().props('isPlaying')).toBe(false);
      expect(player.isTimerRunning).toBe(false);
    });
  });

  describe('play/pause', () => {
    it('Space toggles playback while the controls are auto-hidden', async () => {
      useUIStore().isControlsVisible = false;
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();

      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('a click on the video with hidden controls only reveals them', async () => {
      useUIStore().isControlsVisible = false;
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      (HTMLMediaElement.prototype.play as Mock).mockClear();

      await wrapper!.find('video').trigger('click');
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('drives the VR player in VR mode (control bar and Space)', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      controls().vm.$emit('toggle-vr');
      await settle();
      expect(wrapper!.find('.vr-video-player-mock').exists()).toBe(true);

      controls().vm.$emit('toggle-play');
      expect(vrTogglePlay).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
      expect(vrTogglePlay).toHaveBeenCalledTimes(2);
    });

    it("handles the VR player's error, playing and ended events", async () => {
      usePlaylistStore().currentItem = item('hevc.mp4');
      await mountDisplay();
      controls().vm.$emit('toggle-vr');
      await settle();
      const vr = () => wrapper!.findComponent({ name: 'VRVideoPlayer' });

      // A decode error falls back to HLS, like in the flat player.
      vr().vm.$emit('error', new Event('error'));
      await settle();
      expect(api.getHlsUrl).toHaveBeenCalledWith('/lib/hevc.mp4');
      expect(vr().props('src')).toBe(HLS_URL);
      expect(wrapper!.text()).toContain('Transcoding...');

      vr().vm.$emit('playing');
      await nextTick();
      expect(wrapper!.text()).not.toContain('Transcoding...');

      vr().vm.$emit('ended');
      expect(slideshow.navigateMedia).toHaveBeenCalledWith(1);
    });
  });

  describe('keyboard guards', () => {
    const press = (
      target: EventTarget,
      init: KeyboardEventInit,
    ): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };

    it('leaves Space and arrows to text fields and sliders', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      (HTMLMediaElement.prototype.play as Mock).mockClear();
      const input = document.createElement('input');
      const range = document.createElement('input');
      range.type = 'range';
      document.body.append(input, range);

      expect(press(input, { code: 'Space', key: ' ' }).defaultPrevented).toBe(
        false,
      );
      expect(press(range, { code: 'ArrowLeft' }).defaultPrevented).toBe(false);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('ignores keys while a modal dialog (e.g. the lock screen) is open', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      (HTMLMediaElement.prototype.play as Mock).mockClear();
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      document.body.append(dialog);

      expect(press(document.body, { code: 'Space' }).defaultPrevented).toBe(
        false,
      );
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('leaves browser chords such as Alt+ArrowLeft alone', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      const el = video();
      Object.defineProperty(el, 'duration', { value: 100 });
      el.currentTime = 50;

      const event = press(document.body, { code: 'ArrowLeft', altKey: true });
      expect(event.defaultPrevented).toBe(false);
      expect(el.currentTime).toBe(50);
    });

    it('lets a focused button activate itself with Space', async () => {
      usePlaylistStore().currentItem = item('a.mp4');
      await mountDisplay();
      (HTMLMediaElement.prototype.play as Mock).mockClear();
      const button = document.createElement('button');
      document.body.append(button);

      expect(press(button, { code: 'Space' }).defaultPrevented).toBe(false);
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
  });

  it('rolls back an optimistic rating when saving fails', async () => {
    const current = item('a.mp4', { rating: 2 });
    usePlaylistStore().currentItem = current;
    (api.setRating as Mock).mockRejectedValue(new Error('429'));
    await mountDisplay();

    controls().vm.$emit('set-rating', 4);
    await settle();

    expect(api.setRating).toHaveBeenCalledWith('/lib/a.mp4', 4);
    expect(usePlaylistStore().currentItem!.rating).toBe(2);
    expect(toast.error).toHaveBeenCalled();
  });
});
