import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useLibraryStore } from '@/composables/useLibraryStore';

describe('useMediaLoader Coverage Boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useLibraryStore().mediaUrlGenerator = (path: string) =>
      `http://media/${path}`;
  });

  it('handles null item', async () => {
    const { loadMedia, mediaUrl } = useMediaLoader();
    await loadMedia(null, vi.fn());
    expect(mediaUrl.value).toBeNull();
  });

  it('handles item without name', async () => {
    const { loadMedia, mediaUrl } = useMediaLoader();
    const item = { path: 'test.mp4' } as any;
    await loadMedia(item, vi.fn());
    expect(mediaUrl.value).toBe('http://media/test.mp4');
  });

  it('handles missing mediaUrlGenerator', async () => {
    useLibraryStore().mediaUrlGenerator = null;
    const { loadMedia, error, isLoading } = useMediaLoader();
    const item = { path: 'test.mp4' } as any;

    await loadMedia(item, vi.fn());
    expect(error.value).toBe('Failed to load media file.');
    expect(isLoading.value).toBe(false);
  });

  it('handles error in mediaUrlGenerator', async () => {
    useLibraryStore().mediaUrlGenerator = () => {
      throw new Error('Fail');
    };
    const { loadMedia, error } = useMediaLoader();
    const item = { path: 'test.mp4' } as any;

    await loadMedia(item, vi.fn());
    expect(error.value).toBe('Failed to load media file.');
  });

  it('ignores stale catch and finally', async () => {
    const { loadMedia, error, currentLoadRequestId } = useMediaLoader();
    const item = { path: 'test.mp4' } as any;

    useLibraryStore().mediaUrlGenerator = () => {
      currentLoadRequestId.value++;
      throw new Error('Async Fail');
    };

    await loadMedia(item, vi.fn());
    expect(error.value).toBeNull();
  });

  it('cancelPendingLoad drops the previous URL and invalidates in-flight loads', async () => {
    const {
      loadMedia,
      cancelPendingLoad,
      mediaUrl,
      error,
      isLoading,
      isVideoSupported,
      currentLoadRequestId,
    } = useMediaLoader();
    await loadMedia({ name: 'a.mp4', path: 'a.mp4' } as any, vi.fn());
    expect(mediaUrl.value).toBe('http://media/a.mp4');
    error.value = 'old error';
    isVideoSupported.value = false;

    // A legacy file whose transcode request is still pending...
    let finishTranscode!: () => void;
    const pending = loadMedia(
      { name: 'b.mkv', path: 'b.mkv' } as any,
      () => new Promise<void>((resolve) => (finishTranscode = resolve)),
    );
    const staleRequestId = currentLoadRequestId.value;
    expect(isLoading.value).toBe(true);

    // ...is superseded by an item change.
    cancelPendingLoad();
    expect(currentLoadRequestId.value).toBe(staleRequestId + 1);
    expect(mediaUrl.value).toBeNull();
    expect(error.value).toBeNull();
    expect(isVideoSupported.value).toBe(true);
    expect(isLoading.value).toBe(false);

    finishTranscode();
    await pending;
    expect(isLoading.value).toBe(false);
  });

  it('ignores stale results after transcode request', async () => {
    const { loadMedia, isLoading, currentLoadRequestId } = useMediaLoader();
    const item = { name: 'test.mkv', path: 'test.mkv' } as any;

    const onTranscode = async () => {
      currentLoadRequestId.value++;
    };

    await loadMedia(item, onTranscode);
    expect(isLoading.value).toBe(true);
  });
});
