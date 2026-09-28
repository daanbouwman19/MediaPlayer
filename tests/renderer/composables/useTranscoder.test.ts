import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { useTranscoder } from '@/composables/useTranscoder';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    getHlsUrl: vi.fn(),
    getHlsStatus: vi.fn(),
    getVideoMetadata: vi.fn(),
  },
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe('useTranscoder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (api.getVideoMetadata as any).mockRejectedValue(new Error('no probe'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

    const promise = startTranscoding('test.mp4');
    expect(isTranscodingMode.value).toBe(true);
    expect(isTranscodingLoading.value).toBe(true);

    const url = await promise;
    expect(url).toBe('http://hls/url');

    // Fast-forward 1s for poll
    vi.advanceTimersByTime(3000);
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
    vi.advanceTimersByTime(3000);

    await vi.waitFor(() => expect(isTranscodingLoading.value).toBe(false));
  });

  it('should reset state', () => {
    const transcoder = useTranscoder();
    transcoder.isTranscodingMode.value = true;
    transcoder.resetTranscoderState();
    expect(transcoder.isTranscodingMode.value).toBe(false);
  });

  it('polls once immediately instead of waiting for the first interval', async () => {
    const { startTranscoding, transcodedDuration } = useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue({
      percent: 5,
      duration: 7200,
    });

    await startTranscoding('movie.mkv');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.getHlsStatus).toHaveBeenCalledTimes(1);
    expect(transcodedDuration.value).toBe(7200);
  });

  it('keeps polling after playback starts until the duration is known', async () => {
    const { startTranscoding, handlePlaybackStarted, transcodedDuration } =
      useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue({ percent: 3, duration: 0 });

    await startTranscoding('movie.mkv');
    await vi.advanceTimersByTimeAsync(0);
    // 'playing' arrives before the server knows the duration.
    handlePlaybackStarted();

    await vi.advanceTimersByTimeAsync(3000);
    expect(api.getHlsStatus).toHaveBeenCalledTimes(2);

    (api.getHlsStatus as any).mockResolvedValue({
      percent: 4,
      duration: 7200,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(transcodedDuration.value).toBe(7200);

    // Duration known and playing: polling stops.
    await vi.advanceTimersByTimeAsync(9000);
    expect(api.getHlsStatus).toHaveBeenCalledTimes(3);
  });

  it('stops polling on playback start when the duration is already known', async () => {
    const { startTranscoding, handlePlaybackStarted, isTranscodingLoading } =
      useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue({ percent: 3, duration: 0 });

    await startTranscoding('movie.mkv', { knownDuration: 5400 });
    await vi.advanceTimersByTimeAsync(0);
    handlePlaybackStarted();
    expect(isTranscodingLoading.value).toBe(false);

    await vi.advanceTimersByTimeAsync(9000);
    expect(api.getHlsStatus).toHaveBeenCalledTimes(1);
  });

  it('seeds the duration from the caller and does not probe then', async () => {
    const { startTranscoding, transcodedDuration } = useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue(null);

    await startTranscoding('movie.mkv', { knownDuration: 5400 });
    expect(transcodedDuration.value).toBe(5400);
    expect(api.getVideoMetadata).not.toHaveBeenCalled();
  });

  it('probes the duration when neither the caller nor the server knows it', async () => {
    const { startTranscoding, transcodedDuration } = useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue({ percent: 1, duration: 0 });
    (api.getVideoMetadata as any).mockResolvedValue({ duration: 3600 });

    await startTranscoding('movie.mkv');
    await vi.advanceTimersByTimeAsync(0);

    expect(api.getVideoMetadata).toHaveBeenCalledWith('movie.mkv');
    expect(transcodedDuration.value).toBe(3600);
  });

  it('ignores a failed or late duration probe', async () => {
    const { startTranscoding, resetTranscoderState, transcodedDuration } =
      useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    (api.getHlsStatus as any).mockResolvedValue(null);
    const probe = deferred<{ duration: number }>();
    (api.getVideoMetadata as any).mockReturnValue(probe.promise);

    await startTranscoding('a.mkv');
    resetTranscoderState();
    probe.resolve({ duration: 3600 });
    await vi.advanceTimersByTimeAsync(0);

    expect(transcodedDuration.value).toBe(0);
  });

  it('drops a stale status response that lands after switching files', async () => {
    const { startTranscoding, resetTranscoderState, transcodedDuration } =
      useTranscoder();
    (api.getHlsUrl as any).mockResolvedValue('http://hls/url');
    const statusA = deferred<{ percent: number; duration: number }>();
    (api.getHlsStatus as any).mockReturnValueOnce(statusA.promise);

    await startTranscoding('a.mkv'); // poll for A in flight
    resetTranscoderState(); // item changes
    (api.getHlsStatus as any).mockResolvedValue({ percent: 1, duration: 0 });
    await startTranscoding('b.mkv', { knownDuration: 90 });

    statusA.resolve({ percent: 100, duration: 7200 });
    await vi.advanceTimersByTimeAsync(0);

    // A's duration must not land on B, and A's 100% must not stop B's poll.
    expect(transcodedDuration.value).toBe(90);
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.getHlsStatus).toHaveBeenLastCalledWith('b.mkv');
    expect(
      (api.getHlsStatus as any).mock.calls.filter(
        (call: string[]) => call[0] === 'b.mkv',
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('returns null when a newer transcode superseded the call', async () => {
    const { startTranscoding } = useTranscoder();
    const urlA = deferred<string>();
    (api.getHlsUrl as any)
      .mockReturnValueOnce(urlA.promise)
      .mockResolvedValueOnce('http://hls/b');
    (api.getHlsStatus as any).mockResolvedValue(null);

    const first = startTranscoding('a.mkv');
    const second = startTranscoding('b.mkv');
    urlA.resolve('http://hls/a');

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBe('http://hls/b');
    // Only the current transcode polls.
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getHlsStatus).not.toHaveBeenCalledWith('a.mkv');
  });

  it('does not reset a newer transcode when a superseded one fails', async () => {
    const { startTranscoding, isTranscodingMode } = useTranscoder();
    const urlA = deferred<string>();
    (api.getHlsUrl as any)
      .mockReturnValueOnce(
        urlA.promise.then(() => Promise.reject(new Error('A failed'))),
      )
      .mockResolvedValueOnce('http://hls/b');
    (api.getHlsStatus as any).mockResolvedValue(null);

    const first = startTranscoding('a.mkv');
    await startTranscoding('b.mkv');
    urlA.resolve('');

    await expect(first).rejects.toThrow('A failed');
    expect(isTranscodingMode.value).toBe(true);
  });
});
