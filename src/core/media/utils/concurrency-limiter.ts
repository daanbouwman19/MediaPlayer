/**
 * @file Utility for limiting the concurrency of asynchronous operations.
 */

/**
 * Limits the number of concurrent asynchronous operations.
 * Useful for preventing resource exhaustion (e.g., EMFILE errors).
 */
export class ConcurrencyLimiter {
  private queue: (() => void)[] = [];
  private activeCount = 0;
  private readonly maxConcurrency: number;

  /**
   * Creates a new ConcurrencyLimiter.
   * @param maxConcurrency - The maximum number of concurrent operations allowed.
   */
  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Executes the given function, waiting if the concurrency limit has been reached.
   * @param fn - The asynchronous function to execute.
   * @returns A promise that resolves to the result of the function.
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) next();
      }
    }
  }
}
