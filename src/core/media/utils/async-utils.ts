/**
 * Options for the callWithRetry function.
 */
export interface RetryOptions {
  /** Number of retries to attempt. Default: 3 */
  retries?: number;
  /** Initial delay in milliseconds. Default: 1000 */
  initialDelay?: number;
  /** Multiplier for the delay after each retry. Default: 2 */
  factor?: number;
  /** Predicate to determine if an error should trigger a retry. Default: always true */
  shouldRetry?: (error: unknown) => boolean;
  /**
   * Callback executed before retrying.
   * @param error The error that caused the retry.
   * @param retriesRemaining The number of retries remaining.
   * @param delay The delay (ms) before the next attempt.
   */
  onRetry?: (error: unknown, retriesRemaining: number, delay: number) => void;
}

/**
 * Executes a function with exponential backoff.
 */
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    retries = 3,
    initialDelay = 1000,
    factor = 2,
    shouldRetry = () => true,
    onRetry,
  } = options;

  try {
    return await fn();
  } catch (error) {
    if (retries > 0 && shouldRetry(error)) {
      if (onRetry) {
        onRetry(error, retries, initialDelay);
      }
      await new Promise((resolve) => setTimeout(resolve, initialDelay));
      return callWithRetry(fn, {
        ...options,
        retries: retries - 1,
        initialDelay: initialDelay * factor,
      });
    }
    throw error;
  }
}
