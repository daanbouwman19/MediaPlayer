/**
 * @file Logger utility that suppresses output in test environments.
 * @module core/utils/logger
 */

/**
 * Logs a message to stdout only if not in test environment.
 * Wrapper around console.log.
 */
export function safeLog(message: unknown, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'test') {
    console.log(message, ...args);
  }
}

/**
 * Logs a warning to stderr only if not in test environment.
 * Wrapper around console.warn.
 */
export function safeWarn(message: unknown, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'test') {
    console.warn(message, ...args);
  }
}

/**
 * Logs an error to stderr only if not in test environment.
 * Wrapper around console.error.
 */
export function safeError(message: unknown, ...args: unknown[]): void {
  if (process.env.NODE_ENV !== 'test') {
    console.error(message, ...args);
  }
}
