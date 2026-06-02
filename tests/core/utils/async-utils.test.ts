import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callWithRetry } from '../../../src/core/media/utils/async-utils';

describe('async-utils', () => {
  describe('callWithRetry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return result immediately if function succeeds', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await callWithRetry(fn);
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const onRetry = vi.fn();

      const promise = callWithRetry(fn, {
        retries: 3,
        initialDelay: 10,
        onRetry,
      });

      // Run all timers to process retries
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const promise = callWithRetry(fn, {
        retries: 2,
        initialDelay: 1,
        onRetry,
      });

      // Attach assertion immediately to avoid unhandled rejection
      const assertion = expect(promise).rejects.toThrow('fail');

      // Run all timers to process all retries
      await vi.runAllTimersAsync();

      await assertion;

      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should not retry if shouldRetry returns false', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const shouldRetry = vi.fn().mockReturnValue(false);

      const promise = callWithRetry(fn, {
        retries: 3,
        initialDelay: 1,
        shouldRetry,
      });

      // Attach assertion immediately to avoid unhandled rejection
      const assertion = expect(promise).rejects.toThrow('fail');

      await vi.runAllTimersAsync();

      await assertion;

      expect(fn).toHaveBeenCalledTimes(1);
      expect(shouldRetry).toHaveBeenCalledWith(new Error('fail'));
    });

    it('should pass correct retriesRemaining and delay to onRetry', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const promise = callWithRetry(fn, {
        retries: 2,
        initialDelay: 100,
        factor: 2,
        onRetry,
      });

      // Suppress unhandled rejection since we only care about side effects
      promise.catch(() => {});

      // Run all timers to process all retries
      await vi.runAllTimersAsync();

      // First retry: 2 retries remaining, delay 100
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.anything(), 2, 100);
      // Second retry: 1 retry remaining, delay 200
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.anything(), 1, 200);
    });
  });
});
