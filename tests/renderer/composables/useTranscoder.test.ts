import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTranscoder } from '@/composables/useTranscoder';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    getHlsUrl: vi.fn(),
    getHlsStatus: vi.fn(),
  },
}));

describe('useTranscoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start transcoding and poll status', async () => {
    const {
      startTranscoding,
      isTranscodingMode,
      isTranscodingLoading,
      transcodingProgress,
    } = useTranscoder();

    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue({ percent: 50, duration: 100 });

    const promise = startTranscoding('test.mp4', 10);
    expect(isTranscodingMode.value).toBe(true);
    expect(isTranscodingLoading.value).toBe(true);

    const url = await promise;
    expect(url).toBe('http://hls/url');

    // Fast-forward 1s for poll
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(api.getHlsStatus).toHaveBeenCalled());

    expect(transcodingProgress.value).toBe(50);
  });

  it('should stop polling when progress reaches 100', async () => {
    const { startTranscoding, isTranscodingLoading } = useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue({
      percent: 100,
      duration: 100,
    });

    await startTranscoding('test.mp4');
    vi.advanceTimersByTime(1000);

    await vi.waitFor(() => expect(isTranscodingLoading.value).toBe(false));
  });

  it('should reset state', () => {
    const transcoder = useTranscoder();
    transcoder.isTranscodingMode.value = true;
    transcoder.resetTranscoderState();
    expect(transcoder.isTranscodingMode.value).toBe(false);
  });
});
