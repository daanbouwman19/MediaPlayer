import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { ref } from 'vue';

vi.mock('@/composables/useLibraryStore');

describe('useMediaLoader Coverage Boost', () => {
  let mockLibraryStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLibraryStore = {
      mediaUrlGenerator: ref((path: string) => `http://media/${path}`),
    };
    (useLibraryStore as unknown as any).mockReturnValue(mockLibraryStore);
  });

  it('handles null item', async () => {
    const { loadMedia, mediaUrl } = useMediaLoader();
    await loadMedia(null, vi.fn());
    expect(mediaUrl.value).toBeNull();
  });

  it('handles item without name', async () => {
    const { loadMedia, mediaUrl } = useMediaLoader();
    const item = { path: 'test.mp4' } as any; // No name
    await loadMedia(item, vi.fn());
    expect(mediaUrl.value).toBe('http://media/test.mp4');
  });

  it('handles missing mediaUrlGenerator', async () => {
    mockLibraryStore.mediaUrlGenerator = null;
    const { loadMedia, error, isLoading } = useMediaLoader();
    const item = { path: 'test.mp4' } as any;

    await loadMedia(item, vi.fn());
    expect(error.value).toBe('Failed to load media file.');
    expect(isLoading.value).toBe(false);
  });

  it('handles error in mediaUrlGenerator', async () => {
    mockLibraryStore.mediaUrlGenerator = () => {
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

    mockLibraryStore.mediaUrlGenerator = async () => {
      // Simulate a new request starting while this one is pending
      currentLoadRequestId.value++;
      throw new Error('Async Fail');
    };

    await loadMedia(item, vi.fn());

    // Error should NOT be set because requestId is stale
    expect(error.value).toBeNull();
    // isLoading should still be true (from the "new" request, although we didn't call loadMedia for it,
    // but in this test we manually incremented currentLoadRequestId)
    // Wait, in real usage isLoading would be managed by the second loadMedia call.
  });

  it('ignores stale results after transcode request', async () => {
    const { loadMedia, isLoading, currentLoadRequestId } = useMediaLoader();
    const item = { name: 'test.mkv', path: 'test.mkv' } as any;

    const onTranscode = async () => {
      currentLoadRequestId.value++; // New request started
    };

    await loadMedia(item, onTranscode);

    // isLoading should NOT be set to false because requestId is stale
    expect(isLoading.value).toBe(true);
  });
});
