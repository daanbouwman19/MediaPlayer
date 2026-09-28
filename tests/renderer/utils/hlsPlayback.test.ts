import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';

const instances: any[] = [];

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
    this.loadSource = vi.fn();
    this.attachMedia = vi.fn();
    this.destroy = vi.fn();
    this.startLoad = vi.fn();
    this.recoverMediaError = vi.fn();
    this.swapAudioCodec = vi.fn();
    instances.push(this);
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
    OTHER_ERROR: 'otherError',
  };
  return { default: MockHls };
});

import Hls from 'hls.js';
import {
  attachHlsSource,
  isHlsSource,
  needsHlsJs,
  HLS_NETWORK_RETRY_BASE_DELAY_MS,
  MAX_HLS_NETWORK_RETRIES,
} from '@/utils/hlsPlayback';

const networkError = {
  fatal: true,
  type: 'networkError',
  details: 'levelLoadError',
};

describe('hlsPlayback', () => {
  let video: HTMLVideoElement;
  let onFatalError: Mock;

  beforeEach(() => {
    instances.length = 0;
    vi.clearAllMocks();
    (Hls.isSupported as Mock).mockReturnValue(true);
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    video = document.createElement('video');
    onFatalError = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('detects HLS sources', () => {
    expect(isHlsSource('/api/hls/master.m3u8?file=a.mkv')).toBe(true);
    expect(isHlsSource('/api/serve?path=a.mp4')).toBe(false);
    expect(isHlsSource(null)).toBe(false);
    expect(needsHlsJs('/x.m3u8')).toBe(true);
    (Hls.isSupported as Mock).mockReturnValue(false);
    expect(needsHlsJs('/x.m3u8')).toBe(false);
  });

  it.each([
    [undefined, 0],
    [0, 0],
    [-1, 0],
    [37.5, 37.5],
  ])('uses startPosition %s -> %s', (requested, expected) => {
    attachHlsSource(video, '/x.m3u8', {
      startPosition: requested,
      onFatalError,
    });
    expect(instances[0].config.startPosition).toBe(expected);
  });

  it('attaches the element, then loads the playlist and reports the manifest', () => {
    const onManifestParsed = vi.fn();
    attachHlsSource(video, '/x.m3u8', { onFatalError, onManifestParsed });
    const hls = instances[0];
    expect(hls.attachMedia).toHaveBeenCalledWith(video);

    hls.fire('mediaAttached');
    expect(hls.loadSource).toHaveBeenCalledWith('/x.m3u8');

    hls.fire('manifestParsed');
    expect(onManifestParsed).toHaveBeenCalled();

    hls.fire('levelLoaded', { details: { live: true } });
    expect(console.log).toHaveBeenCalledWith('[HLS] Level loaded:', 'live');
  });

  it('works without a manifest callback', () => {
    attachHlsSource(video, '/x.m3u8', { onFatalError });
    expect(() => instances[0].fire('manifestParsed')).not.toThrow();
  });

  it('ignores non-fatal errors', () => {
    attachHlsSource(video, '/x.m3u8', { onFatalError });
    instances[0].fire('hlsError', { fatal: false, type: 'networkError' });
    vi.runAllTimers();
    expect(instances[0].startLoad).not.toHaveBeenCalled();
    expect(onFatalError).not.toHaveBeenCalled();
  });

  it('retries fatal network errors with exponential backoff, then gives up', () => {
    attachHlsSource(video, '/x.m3u8', { onFatalError });
    const hls = instances[0];
    hls.fire('manifestParsed');

    let delay = HLS_NETWORK_RETRY_BASE_DELAY_MS;
    for (let attempt = 1; attempt <= MAX_HLS_NETWORK_RETRIES; attempt++) {
      hls.fire('hlsError', networkError);
      vi.advanceTimersByTime(delay - 1);
      expect(hls.startLoad).toHaveBeenCalledTimes(attempt - 1);
      vi.advanceTimersByTime(1);
      expect(hls.startLoad).toHaveBeenCalledTimes(attempt);
      delay *= 2;
    }

    hls.fire('hlsError', networkError);
    expect(hls.destroy).toHaveBeenCalledTimes(1);
    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError.mock.calls[0][0].message).toBe(
      'HLS Fatal Error: levelLoadError',
    );

    // Nothing happens after it gave up.
    hls.fire('hlsError', networkError);
    vi.runAllTimers();
    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).toHaveBeenCalledTimes(MAX_HLS_NETWORK_RETRIES);
  });

  it('reloads the playlist itself while no manifest was parsed yet', () => {
    // e.g. /api/hls/master.m3u8 answering 500: startLoad() would be a no-op
    // and the player would wait forever.
    attachHlsSource(video, '/x.m3u8', { onFatalError });
    const hls = instances[0];
    hls.fire('mediaAttached');
    expect(hls.loadSource).toHaveBeenCalledTimes(1);

    const manifestError = { ...networkError, details: 'manifestLoadError' };
    for (let i = 0; i < MAX_HLS_NETWORK_RETRIES; i++) {
      hls.fire('hlsError', manifestError);
      vi.runAllTimers();
    }
    expect(hls.loadSource).toHaveBeenCalledTimes(MAX_HLS_NETWORK_RETRIES + 1);
    expect(hls.loadSource).toHaveBeenLastCalledWith('/x.m3u8');
    expect(hls.startLoad).not.toHaveBeenCalled();

    hls.fire('hlsError', manifestError);
    expect(onFatalError).toHaveBeenCalledTimes(1);
    expect(onFatalError.mock.calls[0][0].message).toBe(
      'HLS Fatal Error: manifestLoadError',
    );
  });

  it('gives a fresh retry budget once a fragment was buffered again', () => {
    attachHlsSource(video, '/x.m3u8', { onFatalError });
    const hls = instances[0];
    hls.fire('manifestParsed');

    for (let i = 0; i < MAX_HLS_NETWORK_RETRIES; i++) {
      hls.fire('hlsError', networkError);
      vi.runAllTimers();
    }
    hls.fire('fragBuffered');
    hls.fire('hlsError', networkError);
    vi.runAllTimers();

    expect(onFatalError).not.toHaveBeenCalled();
    expect(hls.startLoad).toHaveBeenCalledTimes(MAX_HLS_NETWORK_RETRIES + 1);
  });

  it('reports other fatal errors immediately', () => {
    attachHlsSource(video, '/x.m3u8', { onFatalError });
    instances[0].fire('hlsError', {
      fatal: true,
      type: 'otherError',
      details: 'internalException',
    });
    expect(instances[0].destroy).toHaveBeenCalled();
    expect(onFatalError).toHaveBeenCalledTimes(1);
  });

  it('destroy is idempotent and cancels a pending retry', () => {
    const source = attachHlsSource(video, '/x.m3u8', { onFatalError });
    const hls = instances[0];
    hls.fire('hlsError', networkError);

    source.destroy();
    source.destroy();
    vi.runAllTimers();

    expect(hls.destroy).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).not.toHaveBeenCalled();
  });
});
