import { ref, onBeforeUnmount } from 'vue';
import { api } from '../api/index';

const POLL_INTERVAL_MS = 3000;

export interface StartTranscodingOptions {
  /**
   * Full duration of the file if already known (e.g. from the library
   * database). The HLS playlist only grows while ffmpeg runs, so without it
   * the player would only know the transcoded-so-far length.
   */
  knownDuration?: number | undefined;
}

export function useTranscoder() {
  const isTranscodingMode = ref(false);
  const isTranscodingLoading = ref(false);
  const isBuffering = ref(false);
  /** Full duration of the transcoded file (0 while unknown). */
  const transcodedDuration = ref(0);
  const transcodingProgress = ref<number | null>(null);

  let pollInterval: ReturnType<typeof setInterval> | null = null;

  // Identifies the current transcode; bumped by every start and reset so
  // async results belonging to an earlier file are dropped instead of
  // landing on the current one.
  let generation = 0;
  let playbackStarted = false;

  const stopTranscodingProgressPoll = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  /**
   * Once playback runs, progress is no longer displayed; polling only
   * continues until the real duration is known.
   */
  const stopPollIfDone = () => {
    if (playbackStarted && transcodedDuration.value > 0) {
      stopTranscodingProgressPoll();
    }
  };

  const startTranscodingProgressPoll = (filePath: string) => {
    stopTranscodingProgressPoll();
    transcodingProgress.value = 0;
    const pollGeneration = generation;
    const interval = setInterval(() => void pollProgress(), POLL_INTERVAL_MS);
    pollInterval = interval;

    async function pollProgress() {
      try {
        const status = await api.getHlsStatus(filePath);
        // A newer poll, transcode or reset took over while this was in
        // flight: neither its result nor its stop may touch the current one.
        if (pollGeneration !== generation || pollInterval !== interval) {
          return;
        }
        if (status) {
          transcodingProgress.value = status.percent;
          if (status.duration > 0) {
            transcodedDuration.value = status.duration;
          }
          if (status.percent >= 100) {
            isTranscodingLoading.value = false;
            isBuffering.value = false;
            stopTranscodingProgressPoll();
            return;
          }
          stopPollIfDone();
        }
      } catch (e) {
        console.warn('Failed to poll transcoding progress', e);
      }
    }

    // Poll right away: 'playing' often arrives before the first interval tick.
    void pollProgress();
  };

  /** Fallback when neither the caller nor the server knows the duration. */
  const probeDuration = async (filePath: string) => {
    const probeGeneration = generation;
    try {
      const { duration } = await api.getVideoMetadata(filePath);
      if (
        probeGeneration === generation &&
        transcodedDuration.value === 0 &&
        Number.isFinite(duration) &&
        duration > 0
      ) {
        transcodedDuration.value = duration;
        stopPollIfDone();
      }
    } catch (e) {
      console.warn('Failed to probe duration for transcoding', e);
    }
  };

  const resetTranscoderState = () => {
    generation++;
    playbackStarted = false;
    isTranscodingMode.value = false;
    isTranscodingLoading.value = false;
    isBuffering.value = false;
    transcodedDuration.value = 0;
    transcodingProgress.value = null;
    stopTranscodingProgressPoll();
  };

  /**
   * Begins the transcoding process for a given file and returns the HLS URL,
   * or null when a newer transcode or a reset superseded this call.
   *
   * The HLS stream always covers the whole file from 0 (one session per
   * file), so seeking is done natively on the player, not by restarting.
   */
  const startTranscoding = async (
    filePath: string,
    options: StartTranscodingOptions = {},
  ): Promise<string | null> => {
    const startGeneration = ++generation;
    stopTranscodingProgressPoll();
    playbackStarted = false;
    isTranscodingMode.value = true;
    isTranscodingLoading.value = true;
    transcodingProgress.value = null;
    const knownDuration = options.knownDuration ?? 0;
    transcodedDuration.value =
      Number.isFinite(knownDuration) && knownDuration > 0 ? knownDuration : 0;

    try {
      const hlsUrl = await api.getHlsUrl(filePath);
      if (startGeneration !== generation) return null;
      startTranscodingProgressPoll(filePath);
      if (transcodedDuration.value === 0) void probeDuration(filePath);
      return hlsUrl;
    } catch (e) {
      if (startGeneration === generation) resetTranscoderState();
      throw e;
    }
  };

  /**
   * Called when the transcoded stream actually starts playing: clears the
   * loading overlay, and stops polling as soon as the duration is known.
   */
  const handlePlaybackStarted = () => {
    isTranscodingLoading.value = false;
    isBuffering.value = false;
    playbackStarted = true;
    stopPollIfDone();
  };

  const setBuffering = (buffering: boolean) => {
    // Only alter buffering state if we aren't completely loading the transcode
    if (buffering) {
      if (!isTranscodingLoading.value) {
        isBuffering.value = true;
      }
    } else {
      isBuffering.value = false;
    }
  };

  onBeforeUnmount(() => {
    generation++;
    stopTranscodingProgressPoll();
  });

  return {
    isTranscodingMode,
    isTranscodingLoading,
    isBuffering,
    transcodedDuration,
    transcodingProgress,
    stopTranscodingProgressPoll,
    startTranscodingProgressPoll,
    resetTranscoderState,
    startTranscoding,
    handlePlaybackStarted,
    setBuffering,
  };
}
