/**
 * @file A unit of work shared by several consumers, cancelled once they all leave.
 */

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function abortReason(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Runs `work` once and lets any number of consumers wait for its result.
 * Each consumer can leave early through its own AbortSignal. When the last one
 * has left, the signal passed to `work` is aborted, optionally after a grace
 * period so a consumer that reconnects quickly can rejoin the running work.
 */
export class SharedTask<T> {
  readonly promise: Promise<T>;
  private readonly controller = new AbortController();
  private readonly abandonGraceMs: number;
  private consumers = 0;
  private settled = false;
  private abandonTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(work: (signal: AbortSignal) => Promise<T>, abandonGraceMs = 0) {
    this.abandonGraceMs = abandonGraceMs;
    this.promise = work(this.controller.signal);
    const markSettled = () => {
      this.settled = true;
      this.clearAbandonTimer();
    };
    // Registered first so consumers leaving on settle never abort finished
    // work. It also marks a rejection as handled when nobody is waiting.
    this.promise.then(markSettled, markSettled);
  }

  /** The signal passed to the work. */
  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Waits for the result on behalf of one consumer. Rejects as soon as `signal`
   * aborts; the work itself only stops once no other consumer is waiting.
   */
  join(signal?: AbortSignal): Promise<T> {
    this.consumers++;
    this.clearAbandonTimer();
    return new Promise<T>((resolve, reject) => {
      let left = false;
      const leave = (): boolean => {
        if (left) return false;
        left = true;
        signal?.removeEventListener('abort', onAbort);
        this.release();
        return true;
      };
      const onAbort = () => {
        if (leave()) reject(abortReason(signal));
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.promise.then(
        (value) => {
          if (leave()) resolve(value);
        },
        (error: unknown) => {
          if (leave()) reject(toError(error));
        },
      );
    });
  }

  /** Aborts the work regardless of its consumers. */
  cancel(): void {
    this.clearAbandonTimer();
    this.controller.abort();
  }

  private release(): void {
    this.consumers--;
    if (this.consumers > 0 || this.settled || this.controller.signal.aborted) {
      return;
    }
    if (this.abandonGraceMs <= 0) {
      this.controller.abort();
      return;
    }
    this.abandonTimer = setTimeout(() => {
      this.abandonTimer = null;
      if (this.consumers === 0 && !this.settled) this.controller.abort();
    }, this.abandonGraceMs);
    this.abandonTimer.unref();
  }

  private clearAbandonTimer(): void {
    if (this.abandonTimer) {
      clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
    }
  }
}
