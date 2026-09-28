import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import { SharedTask } from '../../../src/core/media/utils/shared-task';

/** Work that resolves or rejects when told to, and records its signal. */
function controllableWork<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  let signal!: AbortSignal;
  const work = vi.fn((s: AbortSignal) => {
    signal = s;
    return new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  });
  return {
    work,
    resolve: (value: T) => resolve(value),
    reject: (err: unknown) => reject(err),
    get signal() {
      return signal;
    },
  };
}

describe('SharedTask', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the work once and gives every consumer the result', async () => {
    const w = controllableWork<number>();
    const task = new SharedTask(w.work);

    const a = task.join();
    const b = task.join(new AbortController().signal);
    w.resolve(42);

    await expect(a).resolves.toBe(42);
    await expect(b).resolves.toBe(42);
    expect(w.work).toHaveBeenCalledTimes(1);
    expect(w.signal.aborted).toBe(false);
  });

  it('propagates a failure to every consumer as an Error', async () => {
    const w = controllableWork<number>();
    const task = new SharedTask(w.work);
    const a = task.join();
    const b = task.join();
    w.reject('boom');

    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
  });

  it('keeps running while another consumer is still waiting', async () => {
    const w = controllableWork<string>();
    const task = new SharedTask(w.work);
    const leaving = new AbortController();

    const first = task.join(leaving.signal);
    const second = task.join();
    leaving.abort();

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.signal.aborted).toBe(false);

    w.resolve('done');
    await expect(second).resolves.toBe('done');
  });

  it('aborts the work as soon as the last consumer leaves', async () => {
    const w = controllableWork<string>();
    const task = new SharedTask(w.work);
    const a = new AbortController();
    const b = new AbortController();
    const pa = task.join(a.signal);
    const pb = task.join(b.signal);

    a.abort();
    expect(w.signal.aborted).toBe(false);
    b.abort(new Error('client left'));
    expect(w.signal.aborted).toBe(true);

    await expect(pa).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pb).rejects.toThrow('client left');
  });

  it('rejects immediately for an already aborted consumer signal', async () => {
    const w = controllableWork<string>();
    const task = new SharedTask(w.work);
    const controller = new AbortController();
    controller.abort();

    await expect(task.join(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(w.signal.aborted).toBe(true);
  });

  it('waits for the grace period before aborting, and a rejoin cancels it', async () => {
    vi.useFakeTimers();
    const w = controllableWork<string>();
    const task = new SharedTask(w.work, 5000);

    const first = new AbortController();
    const p1 = task.join(first.signal);
    first.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });

    vi.advanceTimersByTime(4000);
    expect(w.signal.aborted).toBe(false);

    // A reconnecting consumer rejoins the running work.
    const p2 = task.join();
    vi.advanceTimersByTime(10_000);
    expect(w.signal.aborted).toBe(false);

    w.resolve('kept');
    await expect(p2).resolves.toBe('kept');
  });

  it('aborts after the grace period when nobody rejoins', async () => {
    vi.useFakeTimers();
    const w = controllableWork<string>();
    const task = new SharedTask(w.work, 5000);
    const controller = new AbortController();
    const p = task.join(controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });

    vi.advanceTimersByTime(5000);
    expect(w.signal.aborted).toBe(true);
  });

  it('never aborts work that already finished', async () => {
    const w = controllableWork<string>();
    const task = new SharedTask(w.work);
    const controller = new AbortController();
    const p = task.join(controller.signal);
    w.resolve('ok');
    await expect(p).resolves.toBe('ok');

    controller.abort();
    expect(w.signal.aborted).toBe(false);
    await expect(task.join()).resolves.toBe('ok');
  });

  it('cancel() aborts regardless of consumers and does not leave unhandled rejections', async () => {
    const task = new SharedTask(
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('stopped')));
        }),
      1000,
    );
    const waiting = task.join();
    task.cancel();
    expect(task.signal.aborted).toBe(true);
    await expect(waiting).rejects.toThrow('stopped');
  });
});
