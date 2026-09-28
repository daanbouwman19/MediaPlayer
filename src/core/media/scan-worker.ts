import { parentPort, type MessagePort } from 'worker_threads';
import type { Credentials } from 'google-auth-library';
import { performFullMediaScan } from './media-scanner.ts';
import { getDriveBackend, registerDriveBackend } from './drive-backend.ts';
import { googleDriveBackend } from '../../infrastructure/google-drive-backend.ts';

// This worker thread is its own composition root.
registerDriveBackend(googleDriveBackend);

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}
const port: MessagePort = parentPort;

/** A request sent by WorkerScannerService through WorkerClient. */
interface ScanRequest {
  id: number;
  type: string;
  payload?: {
    directories?: string[];
    tokens?: Credentials | null;
    previousPaths?: string[];
  };
}

/**
 * Handles one message from the main thread. Never rejects: failures are
 * reported back to the caller as `{ success: false }` results.
 */
export async function handleScanMessage(message: unknown): Promise<void> {
  // Handle calls that match { id, type, payload } structure for WorkerClient
  if (!message || typeof message !== 'object' || !('id' in message)) return;
  const { id, type, payload } = message as ScanRequest;

  if (type !== 'START_SCAN') return;
  try {
    const { directories = [], tokens, previousPaths } = payload ?? {};

    if (tokens) {
      getDriveBackend().setCredentials(tokens);
    }

    const knownPaths = new Set(previousPaths ?? []);

    const albums = await performFullMediaScan(directories, knownPaths);
    port.postMessage({
      id,
      result: { success: true, data: albums },
    });
  } catch (error) {
    port.postMessage({
      id,
      result: {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

port.on('message', (message: unknown) => {
  void handleScanMessage(message);
});
