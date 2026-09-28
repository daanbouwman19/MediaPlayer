import { parentPort, type MessagePort } from 'worker_threads';
import type { Credentials } from 'google-auth-library';
import { performFullMediaScan } from './media-scanner.ts';
import { registerDriveBackend } from './drive-backend.ts';
import { isDrivePath } from './media-utils.ts';

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
    const { directories = [], tokens } = payload ?? {};

    // This worker thread is its own composition root. The Google client (and
    // googleapis) is only loaded when a Drive source is actually being
    // scanned; purely local scans never pay for it.
    if (directories.some(isDrivePath)) {
      const { googleDriveBackend } =
        await import('../../infrastructure/google-drive-backend.ts');
      registerDriveBackend(googleDriveBackend);
      if (tokens) {
        googleDriveBackend.setCredentials(tokens);
      }
    }

    const albums = await performFullMediaScan(directories);
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
