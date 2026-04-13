import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMediaLoader } from '@/composables/useMediaLoader';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { ref } from 'vue';

vi.mock('@/composables/useLibraryStore');

describe('useMediaLoader', () => {
  let mockLibraryStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLibraryStore = {
      mediaUrlGenerator: ref((path: string) => `http://media/${path}`),
    };
    (useLibraryStore as any).mockReturnValue(mockLibraryStore);
  });

  it('should load image media using generator', async () => {
    const { loadMedia, mediaUrl, isLoading } = useMediaLoader();
    const item = { path: 'test.jpg' } as any;

    await loadMedia(item, vi.fn());
    expect(mediaUrl.value).toBe('http://media/test.jpg');
    expect(isLoading.value).toBe(false);
  });

  it('should use transcode request for legacy formats', async () => {
    const { loadMedia, mediaUrl } = useMediaLoader();
    const item = { name: 'test.mkv', path: 'test.mkv' } as any;
    const onTranscode = vi.fn().mockImplementation(async (path) => {
      mediaUrl.value = `http://hls/${path}`;
    });

    await loadMedia(item, onTranscode);
    expect(onTranscode).toHaveBeenCalledWith('test.mkv', expect.any(Number));
    expect(mediaUrl.value).toBe('http://hls/test.mkv');
  });

  it('should ignore stale results if multiple loads happen', async () => {
    const { loadMedia, mediaUrl } = useMediaLoader();
    const item1 = { path: '1.jpg' } as any;
    const item2 = { path: '2.jpg' } as any;

    // Start first load
    const p1 = loadMedia(item1, vi.fn());
    // Start second load immediately
    const p2 = loadMedia(item2, vi.fn());

    await Promise.all([p1, p2]);

    // Only second load should win
    expect(mediaUrl.value).toBe('http://media/2.jpg');
  });
});
