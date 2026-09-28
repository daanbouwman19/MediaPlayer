/**
 * WorkerClient lifecycle: failed inits must not leak the thread, restarts
 * are bounded (with backoff) and only a worker that stays up refills the
 * restart budget.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { Worker } from 'worker_threads';
import { WorkerClient } from '../../src/core/database/worker-client';

vi.mock('../../src/core/media/utils/logger', () => ({
  safeLog: vi.fn(),
  safeError: vi.fn(),
  safeWarn: vi.fn(),
}));

type Reply = { success: boolean; data?: unknown; error?: string } | null;

const control = vi.hoisted(() => ({
  /** Decides the reply to each posted request; null means "never reply". */
  reply: (_message: { id: number; type: string }): Reply => ({
    success: true,
  }),
}));

vi.mock('worker_threads', async () => {
  const { vi } = await import('vite-plus/test');

  class MockWorker {
    private listeners = new Map<string, ((...args: any[]) => void)[]>();
    terminate = vi.fn(async () => 1);
    postMessage = vi.fn((message: { id: number; type: string }) => {
      const result = control.reply(message);
      if (result) {
        queueMicrotask(() => this.emit('message', { id: message.id, result }));
      }
    });

    on(event: string, callback: (...args: any[]) => void) {
      const list = this.listeners.get(event) ?? [];
      list.push(callback);
      this.listeners.set(event, list);
    }

    emit(event: string, ...args: any[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }
  }

  const WorkerSpy = vi.fn(function () {
    return new MockWorker();
  });
  return { Worker: WorkerSpy, default: { Worker: WorkerSpy } };
});

const workers = () => vi.mocked(Worker).mock.results.map((r) => r.value as any);
const latestWorker = () => workers()[workers().length - 1];

const INIT = { type: 'init', payload: { dbPath: '/db.sqlite' } };

describe('WorkerClient lifecycle', () => {
  let client: WorkerClient;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    control.reply = () => ({ success: true });
  });

  afterEach(async () => {
    await client?.terminate();
    vi.useRealTimers();
  });

  describe('failed init (F88)', () => {
    it('terminates the new worker when the initial payload fails', async () => {
      control.reply = () => ({
        success: false,
        error: 'file is not a database',
      });
      client = new WorkerClient('/worker.js');

      await expect(client.init(INIT)).rejects.toThrow('file is not a database');

      expect(latestWorker().terminate).toHaveBeenCalledTimes(1);
      await expect(client.sendMessage('getMetadata')).rejects.toThrow(
        'Worker not initialized',
      );
    });

    it('gives the initial payload its own timeout', async () => {
      control.reply = (message) =>
        message.type === 'init' ? null : { success: true };
      client = new WorkerClient('/worker.js', {
        operationTimeout: 100,
        initTimeout: 5000,
      });
      const init = client.init(INIT);
      const outcome = init.then(
        () => 'resolved',
        (e: Error) => e.message,
      );

      await vi.advanceTimersByTimeAsync(1000);
      expect(latestWorker().terminate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4100);
      expect(await outcome).toBe('Worker operation timed out: init');
      expect(latestWorker().terminate).toHaveBeenCalledTimes(1);
    });

    it('retries a failed re-init with backoff until maxRestarts is spent', async () => {
      client = new WorkerClient('/worker.js', {
        autoRestart: true,
        restartDelay: 100,
        maxRestarts: 3,
      });
      await client.init(INIT);

      // From now on every re-init fails (e.g. the database became corrupt).
      control.reply = () => ({ success: false, error: 'corrupt' });
      latestWorker().emit('exit', 1);

      await vi.advanceTimersByTimeAsync(100); // attempt 1 after 100ms
      expect(Worker).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(150);
      expect(Worker).toHaveBeenCalledTimes(2); // attempt 2 waits 200ms
      await vi.advanceTimersByTimeAsync(50);
      expect(Worker).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(400); // attempt 3 after 400ms
      expect(Worker).toHaveBeenCalledTimes(4);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(Worker).toHaveBeenCalledTimes(4);
      // Every failed attempt released its thread.
      for (const worker of workers().slice(1)) {
        expect(worker.terminate).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe('giving up (F88)', () => {
    it('reports once, with the last failure, when every restart failed', async () => {
      const onUnavailable = vi.fn();
      client = new WorkerClient('/worker.js', {
        name: 'database.js',
        autoRestart: true,
        restartDelay: 10,
        maxRestarts: 2,
        onUnavailable,
      });
      await client.init(INIT);

      control.reply = () => ({ success: false, error: 'corrupt' });
      latestWorker().emit('exit', 1);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(onUnavailable).toHaveBeenCalledTimes(1);
      const error = onUnavailable.mock.calls[0]?.[0] as Error;
      expect(error.message).toBe(
        'database.js is unavailable after 2 failed restarts: corrupt',
      );
      // Requests fail with the reason instead of a bare "not initialized".
      await expect(client.sendMessage('getMetadata')).rejects.toBe(error);
    });

    it('names the exit code when the restarted workers keep crashing', async () => {
      const onUnavailable = vi.fn(() => {
        throw new Error('handler bug');
      });
      client = new WorkerClient('/worker.js', {
        autoRestart: true,
        restartDelay: 10,
        maxRestarts: 1,
        onUnavailable,
      });
      await client.init(INIT);

      latestWorker().emit('exit', 1);
      await vi.advanceTimersByTimeAsync(10);
      latestWorker().emit('exit', 134);
      await vi.advanceTimersByTimeAsync(10_000);

      // A throwing handler does not break the client.
      expect(onUnavailable).toHaveBeenCalledTimes(1);
      await expect(client.sendMessage('getMetadata')).rejects.toThrow(
        'Worker is unavailable after 1 failed restarts: Worker exited unexpectedly with code 134',
      );
    });

    it('clears the failure after a successful manual re-init', async () => {
      client = new WorkerClient('/worker.js', {
        autoRestart: true,
        restartDelay: 10,
        maxRestarts: 0,
      });
      await client.init(INIT);
      latestWorker().emit('exit', 1);
      await expect(client.sendMessage('getMetadata')).rejects.toThrow(
        'unavailable',
      );

      await client.init(INIT);
      await expect(client.sendMessage('getMetadata')).resolves.toBeUndefined();
    });
  });

  describe('restart budget (F89)', () => {
    it('does not treat the unsolicited ready message as a sign of health', async () => {
      client = new WorkerClient('/worker.js', {
        autoRestart: true,
        restartDelay: 10,
        maxRestarts: 2,
      });
      await client.init(INIT);

      for (let crash = 0; crash < 4; crash++) {
        latestWorker().emit('message', { type: 'ready' });
        latestWorker().emit('exit', 134); // e.g. out of memory
        await vi.advanceTimersByTimeAsync(1000);
      }

      // The initial worker plus maxRestarts restarts, then it gives up.
      expect(Worker).toHaveBeenCalledTimes(3);
    });

    it('refills the budget once a restarted worker stayed up long enough', async () => {
      client = new WorkerClient('/worker.js', {
        autoRestart: true,
        restartDelay: 10,
        maxRestarts: 1,
        stableAfter: 5000,
      });
      await client.init(INIT);

      latestWorker().emit('exit', 1);
      await vi.advanceTimersByTimeAsync(10);
      expect(Worker).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(5000); // stable
      latestWorker().emit('exit', 1);
      await vi.advanceTimersByTimeAsync(10);
      expect(Worker).toHaveBeenCalledTimes(3);

      // This one crashes right away: the single restart is used up.
      latestWorker().emit('exit', 1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(Worker).toHaveBeenCalledTimes(3);
    });

    it('cancels a scheduled restart on terminate()', async () => {
      client = new WorkerClient('/worker.js', {
        autoRestart: true,
        restartDelay: 100,
      });
      await client.init(INIT);

      latestWorker().emit('exit', 1);
      await client.terminate();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(Worker).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores events from a worker that has been replaced', async () => {
    client = new WorkerClient('/worker.js', { autoRestart: true });
    await client.init(INIT);
    const first = latestWorker();
    await client.init(INIT);
    const second = latestWorker();
    expect(second).not.toBe(first);

    first.emit('error', new Error('late error'));
    first.emit('exit', 1);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(Worker).toHaveBeenCalledTimes(2);
    await expect(client.sendMessage('ping')).resolves.toBeUndefined();
    expect(second.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'ping' }),
    );
  });

  it('ignores malformed messages and answers to unknown requests', async () => {
    control.reply = (message) =>
      message.type === 'slow' ? null : { success: true };
    client = new WorkerClient('/worker.js');
    await client.init();
    const pending = client.sendMessage<string>('slow');
    const worker = latestWorker();
    const request = worker.postMessage.mock.calls.at(-1)[0] as { id: number };

    worker.emit('message', null);
    worker.emit('message', { id: request.id });
    worker.emit('message', { id: request.id + 100, result: { success: true } });
    worker.emit('message', {
      id: request.id,
      result: { success: true, data: 'done' },
    });

    await expect(pending).resolves.toBe('done');
  });
});
