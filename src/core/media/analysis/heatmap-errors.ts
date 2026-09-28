/**
 * @file Heatmap error types shared by the backend and the renderer.
 * Kept free of Node imports so the renderer can use it too.
 */

/**
 * Message of the "all analysis slots are taken" error. IPC and the web API only
 * carry error messages, so clients recognise the condition by this text.
 */
export const HEATMAP_BUSY_MESSAGE =
  'Heatmap analysis is busy. Please try again later.';

/** Suggested delay before retrying a busy heatmap request. */
export const HEATMAP_BUSY_RETRY_AFTER_SECONDS = 5;

/**
 * Thrown when a heatmap needs a new analysis but the concurrency limit is
 * reached. The request is expected to be retried later.
 */
export class HeatmapBusyError extends Error {
  readonly retryAfterSeconds = HEATMAP_BUSY_RETRY_AFTER_SECONDS;

  constructor() {
    super(HEATMAP_BUSY_MESSAGE);
    this.name = 'HeatmapBusyError';
  }
}

/**
 * Returns true if the error means "busy, retry later", either as the typed
 * error or as its message after crossing IPC or HTTP.
 */
export function isHeatmapBusyError(error: unknown): boolean {
  return (
    error instanceof HeatmapBusyError ||
    (error instanceof Error && error.message === HEATMAP_BUSY_MESSAGE)
  );
}
