/**
 * @file A generic wrapper around Node.js Worker Threads to provide Promisified communication.
 */

import { Worker, type WorkerOptions } from 'worker_threads';
import { safeLog, safeError } from '../media/utils/logger.ts';

interface WorkerResponse<T = unknown> {
  id: number;
  result: {
    success: boolean;
    data?: T;
    error?: string;
  };
}

/**
 * Messages cross the thread boundary untyped. Only `{ id, result }` answers
 * to a request are responses; anything else (such as the `{ type: 'ready' }`
 * a worker announces itself with) is not.
 */
function isWorkerResponse(message: unknown): message is WorkerResponse {
  if (typeof message !== 'object' || message === null) return false;
  const { id, result } = message as { id?: unknown; result?: unknown };
  return (
    typeof id === 'number' &&
    typeof result === 'object' &&
    result !== null &&
    typeof (result as { success?: unknown }).success === 'boolean'
  );
}

interface PendingMessage<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timeoutId: NodeJS.Timeout;
}

interface WorkerClientOptions {
  workerOptions?: WorkerOptions | undefined;
  operationTimeout?: number;
  /**
   * Timeout for the initial payload sent by {@link WorkerClient.init} (e.g.
   * opening and migrating a database), which can legitimately take longer
   * than a regular operation. Defaults to `operationTimeout`.
   */
  initTimeout?: number;
  name?: string;
  autoRestart?: boolean;
  maxRestarts?: number;
  /** Delay before the first restart; each further attempt doubles it. */
  restartDelay?: number;
  /**
   * How long a restarted worker must stay up before its restart budget is
   * refilled. Resetting on the first message instead would let a worker
   * that crashes shortly after starting restart forever.
   */
  stableAfter?: number;
  /**
   * Called once when auto-restart gives up (maxRestarts attempts failed), so
   * the host can tell the user instead of carrying on without the worker.
   */
  onUnavailable?: ((error: Error) => void) | undefined;
}

/** Upper bound for the exponential restart backoff. */
const MAX_RESTART_DELAY_MS = 60_000;

export class WorkerClient {
  private worker: Worker | null = null;
  private pendingMessages = new Map<number, PendingMessage<unknown>>();
  private messageIdCounter = 0;
  private isTerminating = false;
  private operationTimeout: number;
  private initTimeout: number | undefined;
  private workerPath: string | URL;
  private workerOptions: WorkerOptions | undefined;
  private name: string;

  // Auto-restart configuration
  private autoRestart: boolean;
  private maxRestarts: number;
  private restartDelay: number;
  private stableAfter: number;
  private restartCount = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private stableTimer: NodeJS.Timeout | null = null;
  /** Bumped by an explicit terminate() so pending restarts are abandoned. */
  private lifecycle = 0;
  private initialPayload?: { type: string; payload?: unknown };
  private onUnavailable: ((error: Error) => void) | undefined;
  /** Why auto-restart gave up; requests then fail with this reason. */
  private unavailableError: Error | null = null;

  constructor(workerPath: string | URL, options: WorkerClientOptions = {}) {
    this.workerPath = workerPath;
    this.workerOptions = options.workerOptions;
    this.operationTimeout = options.operationTimeout ?? 30000;
    this.initTimeout = options.initTimeout;
    this.name = options.name ?? 'Worker';
    this.autoRestart = options.autoRestart ?? false;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.restartDelay = options.restartDelay ?? 1000;
    this.stableAfter = options.stableAfter ?? 60_000;
    this.onUnavailable = options.onUnavailable;
  }

  /**
   * Initializes the worker thread.
   * If an existing worker is present, it will be terminated and a new one started.
   * If the initial payload fails, the new thread is terminated again (so it
   * cannot keep resources such as an open database file) and the error is
   * rethrown.
   */
  async init(initialPayload?: {
    type: string;
    payload?: unknown;
  }): Promise<void> {
    if (initialPayload) {
      this.initialPayload = initialPayload;
    }

    if (this.worker) {
      console.log(`[${this.name}] Terminating existing worker before re-init.`);
      await this.terminate(false); // Do not reset restart count on manual re-init
    }

    this.isTerminating = false;
    this.unavailableError = null;

    try {
      const worker = new Worker(this.workerPath, this.workerOptions);
      this.worker = worker;

      worker.on('message', (message: unknown) => {
        this.handleMessage(message);
      });

      // Events of a worker that has since been replaced must not touch the
      // current one (e.g. reject its requests or null it out).
      worker.on('error', (error) => {
        if (this.worker !== worker) return;
        safeError(`[${this.name}] Worker error:`, error);
        // Error doesn't necessarily mean exit, but commonly does.
        // We let the 'exit' handler manage restarts.
        this.rejectAllPending(error);
      });

      worker.on('exit', (code) => {
        if (this.worker !== worker) return;
        if (!this.isTerminating) {
          this.handleUnexpectedExit(code);
        } else {
          this.rejectAllPending(new Error('Worker terminated'));
        }
      });

      if (this.initialPayload) {
        await this.send(
          this.initialPayload.type,
          this.initialPayload.payload,
          this.initTimeout ?? this.operationTimeout,
        );
      }

      safeLog(`[${this.name}] Worker initialized successfully.`);
      this.scheduleStableReset();
    } catch (error) {
      safeError(
        `[${this.name}] CRITICAL ERROR: Failed to initialize worker:`,
        error,
      );
      if (this.worker) {
        await this.terminate(false);
      }
      throw error;
    }
  }

  private handleMessage(message: unknown): void {
    // Only an answer to a pending request counts. In particular unsolicited
    // messages are not taken as a sign of health (see stableAfter).
    if (!isWorkerResponse(message)) return;
    const { id, result } = message;
    const pending = this.pendingMessages.get(id);
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pendingMessages.delete(id);
    if (result.success) {
      pending.resolve(result.data);
    } else {
      pending.reject(new Error(result.error || 'Unknown worker error'));
    }
  }

  private handleUnexpectedExit(code: number) {
    safeError(`[${this.name}] Worker exited unexpectedly with code ${code}`);
    this.clearStableTimer();
    this.rejectAllPending(new Error('Worker exited unexpectedly'));
    this.worker = null;

    if (this.autoRestart) {
      this.scheduleRestart(
        new Error(`Worker exited unexpectedly with code ${code}`),
      );
    }
  }

  /**
   * Schedules a restart attempt with exponential backoff. A failed re-init
   * counts as an attempt too and schedules the next one, until maxRestarts
   * attempts have been made without the worker staying up for stableAfter.
   */
  private scheduleRestart(reason: Error): void {
    if (this.restartCount >= this.maxRestarts) {
      safeError(`[${this.name}] Max restarts reached. Giving up.`);
      this.giveUp(reason);
      return;
    }
    this.restartCount++;
    const delay = Math.min(
      this.restartDelay * 2 ** (this.restartCount - 1),
      MAX_RESTART_DELAY_MS,
    );
    console.log(
      `[${this.name}] Attempting restart ${this.restartCount}/${this.maxRestarts} in ${delay}ms...`,
    );
    const lifecycle = this.lifecycle;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.init(this.initialPayload).catch((e: unknown) => {
        safeError(`[${this.name}] Failed to auto-restart worker:`, e);
        // Skip if terminate() was called meanwhile, or if the new worker's
        // exit already scheduled the next attempt.
        if (
          lifecycle === this.lifecycle &&
          !this.restartTimer &&
          !this.worker
        ) {
          this.scheduleRestart(e instanceof Error ? e : new Error(String(e)));
        }
      });
    }, delay);
  }

  private giveUp(reason: Error): void {
    this.unavailableError = new Error(
      `${this.name} is unavailable after ${this.maxRestarts} failed restarts: ${reason.message}`,
    );
    if (!this.onUnavailable) return;
    try {
      this.onUnavailable(this.unavailableError);
    } catch (error) {
      safeError(`[${this.name}] onUnavailable handler failed:`, error);
    }
  }

  /** Refills the restart budget once a restarted worker has stayed up. */
  private scheduleStableReset(): void {
    this.clearStableTimer();
    if (this.restartCount === 0) return;
    const worker = this.worker;
    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      if (this.worker === worker) {
        this.restartCount = 0;
      }
    }, this.stableAfter);
    this.stableTimer.unref();
  }

  private clearStableTimer(): void {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  /**
   * Sends a message to the worker and returns a promise that resolves with the result.
   */
  sendMessage<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
    return this.send<T>(type, payload, this.operationTimeout);
  }

  private send<T>(type: string, payload: unknown, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      // If we are currently restarting (worker is null but autoRestart is true and count < max),
      // maybe we should queue? For now, we reject to keep it simple,
      // as the caller might need to know immediate failure.
      // Or if we just crashed, the consumer might want to retry.

      if (!this.worker) {
        return reject(
          this.unavailableError ?? new Error('Worker not initialized'),
        );
      }

      const id = this.messageIdCounter++;

      const timeoutId = setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Worker operation timed out: ${type}`));
        }
      }, timeout);

      this.pendingMessages.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId,
      });

      try {
        this.worker.postMessage({ id, type, payload });
      } catch (error) {
        safeError(
          `[${this.name}] Error posting message to worker: ${(error as Error).message}`,
        );
        clearTimeout(timeoutId);
        this.pendingMessages.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Terminates the worker thread.
   * @param resetRestartCount - True (the default) for an explicit shutdown,
   *   which also cancels any scheduled restart. Internal re-inits pass false.
   */
  async terminate(resetRestartCount = true): Promise<void> {
    if (resetRestartCount) {
      this.restartCount = 0;
      this.lifecycle++;
      if (this.restartTimer) {
        clearTimeout(this.restartTimer);
        this.restartTimer = null;
      }
    }
    this.clearStableTimer();

    if (this.worker) {
      this.isTerminating = true;
      try {
        await this.worker.terminate();
      } catch (error) {
        safeError(`[${this.name}] Error terminating worker:`, error);
      } finally {
        this.worker = null;
        this.isTerminating = false;
        this.rejectAllPending(new Error('Worker terminated'));
        safeLog(`[${this.name}] Worker terminated.`);
      }
    }
  }

  private rejectAllPending(error: unknown) {
    for (const [id, pending] of this.pendingMessages.entries()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
      this.pendingMessages.delete(id);
    }
  }

  setOperationTimeout(timeout: number) {
    this.operationTimeout = timeout;
  }
}
