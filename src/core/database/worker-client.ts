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

interface PendingMessage<T = unknown> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
  timeoutId: NodeJS.Timeout;
}

interface WorkerClientOptions {
  workerOptions?: WorkerOptions;
  operationTimeout?: number;
  name?: string;
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
}

export class WorkerClient {
  private worker: Worker | null = null;
  private pendingMessages = new Map<number, PendingMessage<unknown>>();
  private messageIdCounter = 0;
  private isTerminating = false;
  private operationTimeout: number;
  private workerPath: string | URL;
  private workerOptions?: WorkerOptions;
  private name: string;

  // Auto-restart configuration
  private autoRestart: boolean;
  private maxRestarts: number;
  private restartDelay: number;
  private restartCount = 0;
  private initialPayload?: { type: string; payload?: unknown };

  constructor(workerPath: string | URL, options: WorkerClientOptions = {}) {
    this.workerPath = workerPath;
    this.workerOptions = options.workerOptions;
    this.operationTimeout = options.operationTimeout ?? 30000;
    this.name = options.name ?? 'Worker';
    this.autoRestart = options.autoRestart ?? false;
    this.maxRestarts = options.maxRestarts ?? 5;
    this.restartDelay = options.restartDelay ?? 1000;
  }

  /**
   * Initializes the worker thread.
   * If an existing worker is present, it will be terminated and a new one started.
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

    try {
      this.worker = new Worker(this.workerPath, this.workerOptions);

      this.worker.on('message', (message: WorkerResponse) => {
        // Successful message means worker is healthy, reset restart count
        if (this.restartCount > 0) {
          this.restartCount = 0;
        }

        const { id, result } = message;
        const pending = this.pendingMessages.get(id);
        if (pending) {
          clearTimeout(pending.timeoutId);
          this.pendingMessages.delete(id);
          if (result.success) {
            pending.resolve(result.data);
          } else {
            pending.reject(new Error(result.error || 'Unknown worker error'));
          }
        }
      });

      this.worker.on('error', (error) => {
        safeError(`[${this.name}] Worker error:`, error);
        // Error doesn't necessarily mean exit, but commonly does.
        // We let the 'exit' handler manage restarts.
        this.rejectAllPending(error);
      });

      this.worker.on('exit', (code) => {
        if (!this.isTerminating) {
          this.handleUnexpectedExit(code);
        } else {
          this.rejectAllPending(new Error('Worker terminated'));
        }
      });

      if (this.initialPayload) {
        await this.sendMessage(
          this.initialPayload.type,
          this.initialPayload.payload,
        );
      }

      safeLog(`[${this.name}] Worker initialized successfully.`);
    } catch (error) {
      safeError(
        `[${this.name}] CRITICAL ERROR: Failed to initialize worker:`,
        error,
      );
      this.worker = null;
      throw error;
    }
  }

  private handleUnexpectedExit(code: number) {
    safeError(`[${this.name}] Worker exited unexpectedly with code ${code}`);
    this.rejectAllPending(new Error('Worker exited unexpectedly'));
    this.worker = null;

    if (this.autoRestart) {
      if (this.restartCount < this.maxRestarts) {
        this.restartCount++;
        console.log(
          `[${this.name}] Attempting restart ${this.restartCount}/${this.maxRestarts} in ${this.restartDelay}ms...`,
        );
        setTimeout(() => {
          this.init(this.initialPayload).catch((e) => {
            safeError(`[${this.name}] Failed to auto-restart worker:`, e);
          });
        }, this.restartDelay);
      } else {
        safeError(`[${this.name}] Max restarts reached. Giving up.`);
      }
    }
  }

  /**
   * Sends a message to the worker and returns a promise that resolves with the result.
   */
  sendMessage<T = unknown>(type: string, payload: unknown = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      // If we are currently restarting (worker is null but autoRestart is true and count < max),
      // maybe we should queue? For now, we reject to keep it simple,
      // as the caller might need to know immediate failure.
      // Or if we just crashed, the consumer might want to retry.

      if (!this.worker) {
        return reject(new Error('Worker not initialized'));
      }

      const id = this.messageIdCounter++;

      const timeoutId = setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Worker operation timed out: ${type}`));
        }
      }, this.operationTimeout);

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
        reject(error);
      }
    });
  }

  /**
   * Terminates the worker thread.
   */
  async terminate(resetRestartCount = true): Promise<void> {
    if (resetRestartCount) {
      this.restartCount = 0;
    }

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
