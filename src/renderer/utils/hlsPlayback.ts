/**
 * @file hls.js wiring shared by VideoPlayer and VRVideoPlayer.
 *
 * Centralises the hls.js configuration (explicit start position) and the
 * fatal-error recovery policy, so both players behave the same: recovery is
 * bounded per source and an unrecoverable stream is reported instead of
 * retrying forever (each playlist reload can restart ffmpeg on the server).
 */
import Hls from 'hls.js';

/** Fatal network errors retried per source before giving up. */
export const MAX_HLS_NETWORK_RETRIES = 3;
/** First network retry delay; doubles on every further attempt. */
export const HLS_NETWORK_RETRY_BASE_DELAY_MS = 1000;
/**
 * Fatal media errors recovered per source: first recoverMediaError(), then
 * swapAudioCodec() + recoverMediaError(); the next one is reported.
 */
export const MAX_HLS_MEDIA_RECOVERIES = 2;

/** True when `src` points at an HLS playlist. */
export const isHlsSource = (src: string | null | undefined): src is string =>
  !!src && src.includes('.m3u8');

/** True when `src` is an HLS playlist that must be played through hls.js. */
export const needsHlsJs = (src: string | null | undefined): src is string =>
  isHlsSource(src) && Hls.isSupported();

export interface HlsAttachOptions {
  /**
   * Absolute position (seconds) to start playback at. Anything <= 0 starts
   * at 0: the transcode playlist has no ENDLIST while ffmpeg is running, so
   * hls.js's default (-1) would treat it as live and jump near its edge.
   */
  startPosition?: number | undefined;
  /** Called once when the stream cannot be recovered; hls.js is already destroyed. */
  onFatalError: (error: Error) => void;
  onManifestParsed?: () => void;
}

export interface HlsSource {
  /** Stops loading, detaches from the element and cancels pending retries. Idempotent. */
  destroy: () => void;
}

/**
 * Plays the HLS playlist `src` in `video` through hls.js.
 */
export function attachHlsSource(
  video: HTMLVideoElement,
  src: string,
  options: HlsAttachOptions,
): HlsSource {
  const startPosition =
    options.startPosition && options.startPosition > 0
      ? options.startPosition
      : 0;
  const hls = new Hls({
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    enableWorker: true,
    startPosition,
  });

  let destroyed = false;
  // hls.js never requests the playlist again by itself: startLoad() only
  // resumes loading once a manifest was parsed, so until then a retry has to
  // load the source again.
  let manifestParsed = false;
  let networkRetries = 0;
  let mediaRecoveries = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    hls.destroy();
  };

  const fail = (details: string) => {
    destroy();
    options.onFatalError(new Error(`HLS Fatal Error: ${details}`));
  };

  hls.on(Hls.Events.MEDIA_ATTACHED, () => {
    hls.loadSource(src);
  });

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    manifestParsed = true;
    options.onManifestParsed?.();
  });

  hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
    console.log('[HLS] Level loaded:', data.details.live ? 'live' : 'vod');
  });

  // A fragment made it into the buffer, so the network path works again:
  // later, unrelated outages get a fresh retry budget.
  hls.on(Hls.Events.FRAG_BUFFERED, () => {
    networkRetries = 0;
  });

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (!data.fatal || destroyed) return;
    console.error('[HLS] Fatal error:', data.type, data.details);

    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      if (networkRetries >= MAX_HLS_NETWORK_RETRIES) {
        fail(data.details);
        return;
      }
      const delay = HLS_NETWORK_RETRY_BASE_DELAY_MS * 2 ** networkRetries;
      networkRetries++;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (destroyed) return;
        if (manifestParsed) hls.startLoad();
        else hls.loadSource(src);
      }, delay);
      return;
    }

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      mediaRecoveries++;
      if (mediaRecoveries > MAX_HLS_MEDIA_RECOVERIES) {
        fail(data.details);
        return;
      }
      if (mediaRecoveries > 1) hls.swapAudioCodec();
      hls.recoverMediaError();
      return;
    }

    // Key system, mux and other fatal errors are not recoverable.
    fail(data.details);
  });

  hls.attachMedia(video);
  return { destroy };
}
