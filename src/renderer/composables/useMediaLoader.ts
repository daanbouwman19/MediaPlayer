import { ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { MediaFile } from '../../core/media/types';
import { LEGACY_VIDEO_EXTENSIONS } from '../../core/media/constants';
import { useLibraryStore } from './useLibraryStore';

export function useMediaLoader() {
  const libraryStore = useLibraryStore();
  const { mediaUrlGenerator } = storeToRefs(libraryStore);

  const currentLoadRequestId = ref(0);
  const isLoading = ref(false);
  const mediaUrl = ref<string | null>(null);
  const error = ref<string | null>(null);
  const isVideoSupported = ref(true);

  /**
   * Invalidates any in-flight load and drops the previous item's URL and
   * error state. Call it synchronously when the current item changes, before
   * any await, so the previous URL can neither be rendered for nor applied
   * to the next item while its own load is still pending.
   */
  const cancelPendingLoad = () => {
    currentLoadRequestId.value++;
    isLoading.value = false;
    mediaUrl.value = null;
    error.value = null;
    isVideoSupported.value = true;
  };

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
        const url = mediaUrlGenerator.value(item.path);

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
    cancelPendingLoad,
    loadMedia,
  };
}
