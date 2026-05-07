import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useTranscoder } from '@/composables/useTranscoder';
import { api } from '@/api';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

vi.mock('@/api', () => ({
  api: {
    getHlsUrl: vi.fn(),
    getHlsStatus: vi.fn(),
  },
}));

describe('useTranscoder Coverage Boost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles null status during polling', async () => {
    const { startTranscodingProgressPoll, transcodingProgress } =
      useTranscoder();
    (api.getHlsStatus as any).mockResolvedValue(null);

    startTranscodingProgressPoll('test.mp4');
    expect(transcodingProgress.value).toBe(0);

    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => expect(api.getHlsStatus).toHaveBeenCalled());
    expect(transcodingProgress.value).toBe(0); // remains 0
  });

  it('handles zero/negative duration during polling', async () => {
    const { startTranscodingProgressPoll, transcodedDuration } =
      useTranscoder();
    (api.getHlsStatus as any).mockResolvedValue({ percent: 50, duration: 0 });

    startTranscodingProgressPoll('test.mp4');
    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => expect(api.getHlsStatus).toHaveBeenCalled());
    expect(transcodedDuration.value).toBe(0);
  });

  it('handles polling error', async () => {
    const { startTranscodingProgressPoll } = useTranscoder();
    (api.getHlsStatus as any).mockRejectedValue(new Error('Poll fail'));
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    startTranscodingProgressPoll('test.mp4');
    vi.advanceTimersByTime(3000);
    await vi.waitFor(() => expect(api.getHlsStatus).toHaveBeenCalled());
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('handles startTranscoding error', async () => {
    const { startTranscoding, isTranscodingMode } = useTranscoder();
    (api.getHlsUrl as any).mockRejectedValue(new Error('Start fail'));

    await expect(startTranscoding('test.mp4')).rejects.toThrow('Start fail');
    expect(isTranscodingMode.value).toBe(false);
  });

  it('setBuffering logic', () => {
    const { setBuffering, isBuffering, isTranscodingLoading } = useTranscoder();

    // Buffering true, loading false -> isBuffering true
    isTranscodingLoading.value = false;
    setBuffering(true);
    expect(isBuffering.value).toBe(true);

    // Buffering true, loading true -> isBuffering remains false
    isBuffering.value = false;
    isTranscodingLoading.value = true;
    setBuffering(true);
    expect(isBuffering.value).toBe(false);

    // Buffering false -> isBuffering false
    isBuffering.value = true;
    setBuffering(false);
    expect(isBuffering.value).toBe(false);
  });

  it('stops polling on unmount', () => {
    const TestComponent = defineComponent({
      setup() {
        const { startTranscodingProgressPoll } = useTranscoder();
        startTranscodingProgressPoll('test.mp4');
        return {};
      },
      template: '<div></div>',
    });

    const wrapper = mount(TestComponent);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    wrapper.unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});
