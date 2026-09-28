/**
 * @file Graceful shutdown and listen-error handling for server mode.
 */
import { closeDatabase } from '../core/database/database.ts';
import { shutdownTranscoding } from '../core/media/transcode-queue-manager.ts';

/** Exit anyway if cleanup hangs; below Docker's default 10 s stop timeout. */
const FORCE_EXIT_MS = 8000;

/** The parts of http(s).Server used here. */
export interface LifecycleServer {
  close(callback?: (err?: Error) => void): unknown;
  closeAllConnections?: () => void;
  on(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown;
}

/**
 * Stops accepting requests, stops every ffmpeg process (HLS sessions and the
 * pre-transcode queue) and closes the database.
 */
export async function shutdownServer(server: LifecycleServer): Promise<void> {
  const closed = new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  // Open streams (video, HLS segments) would otherwise keep close() waiting.
  server.closeAllConnections?.();
  await Promise.all([closed, shutdownTranscoding()]);
  await closeDatabase();
}

/**
 * Handles SIGTERM/SIGINT with a graceful shutdown (a second signal exits at
 * once) and reports listen errors such as EADDRINUSE readably. Returns a
 * function that removes the signal handlers.
 */
export function installServerLifecycle(
  server: LifecycleServer,
  exit: (code: number) => void = (code) => process.exit(code),
): () => void {
  server.on('error', (err) => {
    const hint =
      err.code === 'EADDRINUSE'
        ? ' (is another instance running? Set PORT to use another port)'
        : '';
    console.error(`Server error: ${err.message}${hint}`);
    exit(1);
  });

  let shuttingDown = false;
  const onSignal = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      exit(1);
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    const forceExit = setTimeout(() => {
      console.error('Shutdown timed out, exiting.');
      exit(1);
    }, FORCE_EXIT_MS);
    forceExit.unref();
    void shutdownServer(server).then(
      () => {
        clearTimeout(forceExit);
        exit(0);
      },
      (err: unknown) => {
        console.error('Shutdown failed:', err);
        clearTimeout(forceExit);
        exit(1);
      },
    );
  };

  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
  return () => {
    process.off('SIGTERM', onSignal);
    process.off('SIGINT', onSignal);
  };
}
