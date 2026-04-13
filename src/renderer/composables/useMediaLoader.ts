import { ref } from 'vue';
import type { MediaFile } from '../../core/types';
import { LEGACY_VIDEO_EXTENSIONS } from '../../core/constants';
import { useLibraryStore } from './useLibraryStore';

export function useMediaLoader() {
  const libraryStore = useLibraryStore();
  const { mediaUrlGenerator } = libraryStore;

  const currentLoadRequestId = ref(0);
  const isLoading = ref(false);
  const mediaUrl = ref<string | null>(null);
  const error = ref<string | null>(null);
  const isVideoSupported = ref(true);

  const loadMedia = async (
    item: MediaFile | null,
    onTranscodeRequest: (filePath: string, reqId: number) => Promise<void>,
  ) => {
    currentLoadRequestId.value++;
    const requestId = currentLoadRequestId.value;

    if (!item) {
      mediaUrl.value = null;
      return;
    }

    isLoading.value = true;
    error.value = null;
    isVideoSupported.value = true;

    // Proactively transcode formats that often fail in browsers
    const fileName = item.name ? item.name.toLowerCase() : '';
    if (LEGACY_VIDEO_EXTENSIONS.some((ext) => fileName.endsWith(ext))) {
      console.log('Proactively transcoding legacy format:', fileName);
      await onTranscodeRequest(item.path, requestId);
      if (requestId === currentLoadRequestId.value) {
        isLoading.value = false;
      }
      return;
    }

    try {
      if (mediaUrlGenerator.value) {
        const url = await mediaUrlGenerator.value(item.path);

        if (requestId !== currentLoadRequestId.value) return;

        mediaUrl.value = url;
      } else {
        throw new Error('Media URL generator not ready');
      }
    } catch (err) {
      if (requestId !== currentLoadRequestId.value) return;

      console.error('Error loading media:', err);
      error.value = 'Failed to load media file.';
      mediaUrl.value = null;
    } finally {
      if (requestId === currentLoadRequestId.value) {
        isLoading.value = false;
      }
    }
  };

  return {
    currentLoadRequestId,
    isLoading,
    mediaUrl,
    error,
    isVideoSupported,
    loadMedia,
  };
}
