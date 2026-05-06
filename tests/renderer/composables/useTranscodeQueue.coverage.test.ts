import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTranscodeQueue } from '@/composables/useTranscodeQueue';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    listTranscodeJobs: vi.fn(),
    addTranscodeJobs: vi.fn(),
    cancelTranscodeJob: vi.fn(),
  },
}));

describe('useTranscodeQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (api.listTranscodeJobs as any).mockResolvedValue([]);
    (api.addTranscodeJobs as any).mockResolvedValue(undefined);
    (api.cancelTranscodeJob as any).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startPolling immediately polls and sets up interval', async () => {
    const { startPolling, stopPolling } = useTranscodeQueue();
    startPolling();
    await vi.runAllTicks();
    expect(api.listTranscodeJobs).toHaveBeenCalledOnce();
    stopPolling();
  });

  it('poll maps jobs to jobStatusMap', async () => {
    const jobs = [
      { file_path: '/a.mp4', status: 'pending' },
      { file_path: '/b.mp4', status: 'done' },
    ];
    (api.listTranscodeJobs as any).mockResolvedValue(jobs);
    const { startPolling, stopPolling, jobStatusMap } = useTranscodeQueue();
    startPolling();
    await vi.runAllTicks();
    expect(jobStatusMap.value.get('/a.mp4')).toBe('pending');
    expect(jobStatusMap.value.get('/b.mp4')).toBe('done');
    stopPolling();
  });

  it('poll swallows errors silently', async () => {
    (api.listTranscodeJobs as any).mockRejectedValue(new Error('Network fail'));
    const { startPolling, stopPolling } = useTranscodeQueue();
    await expect(async () => {
      startPolling();
      await vi.runAllTicks();
    }).not.toThrow();
    stopPolling();
  });

  it('stopPolling clears timer and sets it null', async () => {
    const clearSpy = vi.spyOn(global, 'clearInterval');
    const { startPolling, stopPolling } = useTranscodeQueue();
    startPolling();
    await vi.runAllTicks();
    stopPolling();
    expect(clearSpy).toHaveBeenCalled();
    // Second call is a no-op (pollTimer is null)
    stopPolling();
  });

  it('startPolling polls on interval', async () => {
    const { startPolling, stopPolling } = useTranscodeQueue();
    startPolling();
    await vi.runAllTicks();
    vi.advanceTimersByTime(2000);
    await vi.runAllTicks();
    expect(api.listTranscodeJobs).toHaveBeenCalledTimes(2);
    stopPolling();
  });

  it('addJobs calls api and re-polls', async () => {
    const { addJobs } = useTranscodeQueue();
    await addJobs(['/a.mp4', '/b.mp4']);
    expect(api.addTranscodeJobs).toHaveBeenCalledWith(['/a.mp4', '/b.mp4']);
    await vi.runAllTicks();
    expect(api.listTranscodeJobs).toHaveBeenCalled();
  });

  it('cancelJob calls api and re-polls', async () => {
    const { cancelJob } = useTranscodeQueue();
    await cancelJob('/a.mp4');
    expect(api.cancelTranscodeJob).toHaveBeenCalledWith('/a.mp4');
    await vi.runAllTicks();
    expect(api.listTranscodeJobs).toHaveBeenCalled();
  });
});
