import { ref, onBeforeUnmount } from 'vue';
import { api } from '../api/index';

export function useTranscoder() {
  const isTranscodingMode = ref(false);
  const isTranscodingLoading = ref(false);
  const isBuffering = ref(false);
  const transcodedDuration = ref(0);
  const transcodingProgress = ref<number | null>(null);
  const currentTranscodeStartTime = ref(0);

  const transcodingPollInterval = ref<NodeJS.Timeout | null>(null);

  const stopTranscodingProgressPoll = () => {
    if (transcodingPollInterval.value) {
      clearInterval(transcodingPollInterval.value);
      transcodingPollInterval.value = null;
    }
  };

  const startTranscodingProgressPoll = (filePath: string) => {
    stopTranscodingProgressPoll();
    transcodingProgress.value = 0;

    transcodingPollInterval.value = setInterval(async () => {
      try {
        const status = await api.getHlsStatus(filePath);
        if (status) {
          transcodingProgress.value = status.percent;
          if (status.duration > 0) {
            transcodedDuration.value = status.duration;
          }
          if (status.percent >= 100) {
            isTranscodingLoading.value = false;
            isBuffering.value = false;
            stopTranscodingProgressPoll();
          }
        }
      } catch (e) {
        console.warn('Failed to poll transcoding progress', e);
      }
    }, 3000);
  };

  const resetTranscoderState = () => {
    isTranscodingMode.value = false;
    isTranscodingLoading.value = false;
    isBuffering.value = false;
    transcodedDuration.value = 0;
    transcodingProgress.value = null;
    currentTranscodeStartTime.value = 0;
    stopTranscodingProgressPoll();
  };

  /**
   * Begins the transcoding process for a given file and returns the HLS URL.
   */
  const startTranscoding = async (
    filePath: string,
    startTime = 0,
  ): Promise<string> => {
    isTranscodingMode.value = true;
    isTranscodingLoading.value = true;
    currentTranscodeStartTime.value = startTime;

    try {
      const hlsUrl = await api.getHlsUrl(filePath);
      startTranscodingProgressPoll(filePath);
      return hlsUrl;
    } catch (e) {
      resetTranscoderState();
      throw e;
    }
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
    stopTranscodingProgressPoll();
  });

  return {
    isTranscodingMode,
    isTranscodingLoading,
    isBuffering,
    transcodedDuration,
    transcodingProgress,
    currentTranscodeStartTime,
    stopTranscodingProgressPoll,
    startTranscodingProgressPoll,
    resetTranscoderState,
    startTranscoding,
    setBuffering,
  };
}
