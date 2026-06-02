import { parentPort } from 'worker_threads';
import { performFullMediaScan } from './media-scanner.ts';
import { initializeManualCredentials } from '../../main/google-auth.ts';

const port = parentPort;
if (!port) {
  throw new Error('This module must be run as a worker thread');
}

port.on('message', async (message) => {
  // Handle calls that match { id, type, payload } structure for WorkerClient
  if (message && typeof message === 'object' && 'id' in message) {
    const { id, type, payload } = message;

    if (type === 'START_SCAN') {
      try {
        const { directories, tokens, previousPaths } = payload || {};

        if (tokens) {
          initializeManualCredentials(tokens);
        }

        const knownPaths = new Set((previousPaths as string[]) || []);

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
  }
});
