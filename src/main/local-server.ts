/**
 * @file Manages a local HTTP server for streaming media files.
 * Uses shared logic from the core module.
 *
 * [SECURITY] The server only answers the app's renderer: requests must carry
 * a random per-launch token, which Electron adds to every request the
 * renderer's session sends here (see authorizeSessionRequests), and a Host
 * header naming the loopback address, which defeats DNS rebinding. Other
 * local processes and web pages can reach the port but not the media.
 */
import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import type { Session } from 'electron';
import { createMediaApp } from '../core/media/media-handler';
import { getMimeType as coreGetMimeType } from '../core/media/utils/mime-types';
import { MediaService } from '../core/media/media-service';
import { getFFmpegStaticPath } from '../infrastructure/ffmpeg-static-path';

/** Request header that carries the access token. */
export const ACCESS_TOKEN_HEADER = 'x-media-token';

const accessToken = crypto.randomBytes(32).toString('hex');
const accessTokenBuffer = Buffer.from(accessToken);

export interface LocalServerOptions {
  /**
   * Origins allowed to read responses cross-origin (the renderer's origin).
   * Omitted, CORS stays open to any origin.
   */
  allowedOrigins?: string[];
}

/**
 * Holds the singleton instance of the HTTP server.
 */
let serverInstance: http.Server | null = null;

/**
 * Resolves with the port once the current server is listening.
 */
let serverReady: Promise<number> | null = null;

/**
 * Stores the port the server is currently running on. Defaults to 0 if not running.
 */
let serverPort = 0;

/**
 * Determines the MIME type of a file based on its extension.
 * Re-exports the core function.
 */
export const getMimeType = coreGetMimeType;

function hasValidToken(value: string | string[] | undefined): boolean {
  if (typeof value !== 'string') return false;
  const provided = Buffer.from(value);
  return (
    provided.length === accessTokenBuffer.length &&
    crypto.timingSafeEqual(provided, accessTokenBuffer)
  );
}

function isLoopbackHost(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase();
  return (
    normalized === `127.0.0.1:${port}` || normalized === `localhost:${port}`
  );
}

/**
 * Returns why a request must be refused, or null if it may be served.
 */
function getRejection(
  req: http.IncomingMessage,
  port: number,
): { status: number; message: string } | null {
  if (!isLoopbackHost(req.headers.host, port)) {
    return { status: 403, message: 'Invalid Host header' };
  }
  // CORS preflights never carry credentials; they are answered by the CORS
  // middleware and never reach a media route.
  if (req.method === 'OPTIONS') return null;
  if (!hasValidToken(req.headers[ACCESS_TOKEN_HEADER])) {
    return { status: 403, message: 'Access denied' };
  }
  return null;
}

/**
 * Starts the local HTTP server if it is not already running.
 * @returns The port, once the server is listening.
 */
async function startLocalServer(
  cacheDir: string,
  mediaService: MediaService,
  options: LocalServerOptions = {},
): Promise<number> {
  if (serverInstance && serverReady) {
    console.warn('[local-server.js] Server already started. Ignoring request.');
    return serverReady;
  }

  const ffmpegPath = getFFmpegStaticPath();

  const requestHandler = createMediaApp({
    ffmpegPath: ffmpegPath || null,
    cacheDir,
    mediaService,
    ...(options.allowedOrigins
      ? { allowedOrigins: options.allowedOrigins }
      : {}),
  });

  const server = http.createServer((req, res) => {
    const rejection = getRejection(req, serverPort);
    if (rejection) {
      res.writeHead(rejection.status, { 'Content-Type': 'text/plain' });
      res.end(rejection.message);
      return;
    }
    requestHandler(req, res);
  });
  serverInstance = server;

  const ready = new Promise<number>((resolve, reject) => {
    let listening = false;

    server.on('error', (err) => {
      console.error('[local-server.js] Server Error:', err);
      if (serverInstance === server) {
        serverInstance = null;
        serverReady = null;
        serverPort = 0;
      }
      if (!listening) reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      listening = true;
      const address = server.address() as AddressInfo | null;
      serverPort = address ? address.port : 0;
      console.log(
        `[local-server.js] Local media server started on http://localhost:${serverPort}`,
      );

      if (process.env.NODE_ENV === 'test') {
        server.unref();
      }
      resolve(serverPort);
    });
  });
  serverReady = ready;
  return ready;
}

/**
 * Stops the local HTTP server if it is running.
 * @param callback - An optional callback to execute after the server has closed.
 */
function stopLocalServer(callback?: () => void): void {
  if (serverInstance) {
    const server = serverInstance;
    serverInstance = null;
    serverReady = null;
    server.close((err) => {
      if (err) {
        console.error('[local-server.js] Error stopping server:', err);
      } else {
        console.log('[local-server.js] Local media server stopped.');
      }
      // A server started meanwhile owns the port now.
      if (!serverInstance) serverPort = 0;
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

/**
 * Gets this launch's access token (for trusted main-process callers).
 */
function getServerAccessToken(): string {
  return accessToken;
}

/**
 * Makes an Electron session send the access token with every request to the
 * local server on `port`, so <img>, <video>, hls.js and fetch requests from
 * the renderer are authorized while page scripts never see the token.
 * A session keeps a single onBeforeSendHeaders listener; this replaces it.
 */
function authorizeSessionRequests(
  session: Pick<Session, 'webRequest'>,
  port: number,
): void {
  session.webRequest.onBeforeSendHeaders(
    { urls: [`http://127.0.0.1:${port}/*`, `http://localhost:${port}/*`] },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          [ACCESS_TOKEN_HEADER]: accessToken,
        },
      });
    },
  );
}

export {
  startLocalServer,
  stopLocalServer,
  getServerPort,
  getServerAccessToken,
  authorizeSessionRequests,
};
