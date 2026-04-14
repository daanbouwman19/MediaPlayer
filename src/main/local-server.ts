/**
 * @file Manages a local HTTP server for streaming media files.
 * Uses shared logic from the core module.
 */
import http from 'http';
import { AddressInfo } from 'net';
import { createMediaApp } from '../core/media-handler';
import { getMimeType as coreGetMimeType } from '../core/utils/mime-types';
import { MediaService } from '../core/media-service';

/**
 * Holds the singleton instance of the HTTP server.
 */
let serverInstance: http.Server | null = null;

/**
 * Stores the port the server is currently running on. Defaults to 0 if not running.
 */
let serverPort = 0;

/**
 * Determines the MIME type of a file based on its extension.
 * Re-exports the core function.
 */
export const getMimeType = coreGetMimeType;

/**
 * Starts the local HTTP server if it is not already running.
 * @param onReadyCallback - A callback function executed once the server has started and the port is assigned.
 */
async function startLocalServer(
  cacheDir: string,
  mediaService: MediaService,
  onReadyCallback?: () => void,
): Promise<void> {
  if (serverInstance) {
    console.warn('[local-server.js] Server already started. Ignoring request.');
    if (onReadyCallback && typeof onReadyCallback === 'function') {
      onReadyCallback();
    }
    return;
  }

  const { default: ffmpegPath } = await import('ffmpeg-static');

  const requestHandler = createMediaApp({
    ffmpegPath: ffmpegPath || null,
    cacheDir,
    mediaService,
  });

  serverInstance = http.createServer(requestHandler);

  serverInstance.listen(0, '127.0.0.1', () => {
    const address = serverInstance?.address() as AddressInfo;
    serverPort = address ? address.port : 0;
    console.log(
      `[local-server.js] Local media server started on http://localhost:${serverPort}`,
    );

    if (process.env.NODE_ENV === 'test') {
      serverInstance?.unref();
    }

    if (onReadyCallback && typeof onReadyCallback === 'function') {
      onReadyCallback();
    }
  });

  serverInstance.on('error', (err) => {
    console.error('[local-server.js] Server Error:', err);
    serverInstance = null;
    serverPort = 0;
  });
}

/**
 * Stops the local HTTP server if it is running.
 * @param callback - An optional callback to execute after the server has closed.
 */
function stopLocalServer(callback?: () => void): void {
  if (serverInstance) {
    serverInstance.close((err) => {
      if (err) {
        console.error('[local-server.js] Error stopping server:', err);
      } else {
        console.log('[local-server.js] Local media server stopped.');
      }
      serverInstance = null;
      serverPort = 0;
      if (callback && typeof callback === 'function') {
        callback();
      }
    });
  } else if (callback && typeof callback === 'function') {
    callback();
  }
}

/**
 * Gets the port the local server is currently running on.
 * @returns The server port, or 0 if the server is not running.
 */
function getServerPort(): number {
  return serverPort;
}

export { startLocalServer, stopLocalServer, getServerPort };
