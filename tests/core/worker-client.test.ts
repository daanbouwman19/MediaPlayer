import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerClient } from '../../src/core/database/worker-client';
import { Worker } from 'worker_threads';
import * as logger from '../../src/core/media/utils/logger';

// Mock logger
vi.mock('../../src/core/media/utils/logger', () => ({
  safeLog: vi.fn(),
  safeError: vi.fn(),
  safeWarn: vi.fn(),
}));

// Mock worker_threads
vi.mock('worker_threads', async () => {
  const { vi } = await import('vitest');

  class MockWorker {
    postMessage = vi.fn();
    terminate = vi.fn();
    private listeners = new Map<string, ((...args: any[]) => void)[]>();

    on(event: string, callback: (...args: any[]) => void) {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, []);
      }
      this.listeners.get(event)!.push(callback);
    }

    emit(event: string, ...args: any[]) {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        callbacks.forEach((cb) => cb(...args));
      }
    }
  }

  const WorkerSpy = vi.fn(function () {
    return new MockWorker();
  });

  return {
    Worker: WorkerSpy,
    default: {
      Worker: WorkerSpy,
    },
  };
});

describe('WorkerClient Coverage', () => {
  let client: WorkerClient;
  const workerPath = '/test-worker.js';

  beforeEach(() => {
    vi.clearAllMocks();
    client = new WorkerClient(workerPath);
  });

  afterEach(async () => {
    await client.terminate();
  });

  it('init() terminates existing worker before re-initializing', async () => {
    // First Init
    await client.init();

    // Spy on terminate
    const terminateSpy = vi.spyOn(client, 'terminate');

    // Second Init
    await client.init();

    expect(terminateSpy).toHaveBeenCalled();
  });

  it('init() handles Worker constructor errors', async () => {
    // We mock the implementation of the *constructor* spy.
    // It must throw when called with `new`.
    vi.mocked(Worker).mockImplementationOnce(function () {
      throw new Error('Constructor Fail');
    });

    await expect(client.init()).rejects.toThrow('Constructor Fail');

    expect(logger.safeError).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL ERROR'),
      expect.any(Error),
    );
  });

  it('sendMessage() rejects if worker not initialized', async () => {
    // Do not call init()
    await expect(client.sendMessage('TEST')).rejects.toThrow(
      'Worker not initialized',
    );
  });

  it('sendMessage() handles postMessage errors', async () => {
    await client.init();

    // Access the private worker instance to mock postMessage failure
    // Because we used a class in our mock, accessing the instance is reliable
    const workerInstance = vi.mocked(Worker).mock.results[0].value;
    workerInstance.postMessage.mockImplementation(() => {
      throw new Error('Post failure');
    });

    await expect(client.sendMessage('TEST')).rejects.toThrow('Post failure');
  });

  it('terminate() handles soft close error gracefully', async () => {
    await client.init();
    await client.terminate();
  });

  describe('Auto-Restart', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should auto-restart on unexpected exit', async () => {
      client = new WorkerClient(workerPath, {
        autoRestart: true,
        restartDelay: 100,
      });
      await client.init();

      // Spy on init to check for re-calls
      const initSpy = vi.spyOn(client, 'init');

      // Access worker and emit exit
      const workerInstance = (client as any).worker;

      // Simulate unexpected exit
      workerInstance.emit('exit', 1);

      // Should not called immediately
      expect(initSpy).toHaveBeenCalledTimes(0);

      // Advance timer
      await vi.advanceTimersByTimeAsync(150);

      expect(initSpy).toHaveBeenCalledTimes(1);
    });

    it('should respect maxRestarts', async () => {
      client = new WorkerClient(workerPath, {
        autoRestart: true,
        restartDelay: 50,
        maxRestarts: 2,
      });
      await client.init();

      const initSpy = vi.spyOn(client, 'init');

      // Crash 1
      (client as any).worker.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(60);
      expect(initSpy).toHaveBeenCalledTimes(1);

      // Crash 2 (after re-init)
      (client as any).worker.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(60);
      expect(initSpy).toHaveBeenCalledTimes(2);

      // Crash 3 (should NOT restart)
      (client as any).worker.emit('exit', 1);
      await vi.advanceTimersByTimeAsync(60);
      expect(initSpy).toHaveBeenCalledTimes(2);
    });
  });
});
