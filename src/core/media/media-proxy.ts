import http from 'http';
import crypto from 'crypto';
import type { AddressInfo } from 'net';
import {
  getDriveFileMetadataCached,
  parseDriveFileSize,
} from './drive-backend.ts';
import { getDriveStreamWithCache } from './drive-stream.ts';
import { parseHttpRange, pipeToResponse } from '../network/http-utils.ts';
import { isFileInLibrary } from '../database/database.ts';

/**
 * How long a proxy URL stays valid while none of its requests is streaming.
 * ffmpeg opens its input several times (stream probe, index seeks, the
 * transcode itself), so a URL must survive short gaps between requests.
 */
const TOKEN_IDLE_TTL_MS = 5 * 60 * 1000;

/** Time allowed to receive a request's headers; clients are local ffmpeg. */
const REQUEST_TIMEOUT_MS = 30_000;

const DRIVE_FILE_ID = /^[A-Za-z0-9_-]+$/;
/** Optional format hint for ffmpeg; anything else could break the URL. */
const URL_EXTENSION = /^(\.[a-z0-9]{1,5})?$/;
const STREAM_PATH = /^\/stream\/([A-Za-z0-9_-]+)(?:\.[a-z0-9]{1,5})?$/;

interface TokenLease {
  fileId: string;
  activeRequests: number;
  expiresAt: number;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Masks proxy tokens in text that may contain a proxy URL, such as ffmpeg's
 * stderr, before it is logged.
 */
export function redactProxyTokens(text: string): string {
  return text.replace(/([?&]token=)[\w.~-]+/g, '$1[redacted]');
}

/**
 * Loopback HTTP server that exposes library Drive files to ffmpeg, which can
 * only read local paths and URLs.
 *
 * Every URL carries its own random token that unlocks only that one file and
 * expires once ffmpeg has stopped using it. The URL is visible in ffmpeg's
 * argv and error output, so a single process-wide token would let anyone who
 * can read those fetch every Drive file in the library.
 */
export class InternalMediaProxy {
  private static instance: InternalMediaProxy;
  private server: http.Server;
  private port: number = 0;
  private isListening: boolean = false;
  private startPromise: Promise<void> | null = null;
  /** Leases keyed by the SHA-256 of their token, so lookups leak no timing. */
  private leases = new Map<string, TokenLease>();

  private constructor() {
    this.server = http.createServer(
      {
        headersTimeout: REQUEST_TIMEOUT_MS,
        requestTimeout: REQUEST_TIMEOUT_MS,
      },
      (req, res) => {
        void this.handleRequest(req, res);
      },
    );
  }

  /** Serves one proxied Drive request; all errors are handled here. */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const urlObj = new URL(req.url || '', 'http://127.0.0.1');
      const lease = this.findLease(urlObj.searchParams.get('token'));
      if (!lease) {
        res.writeHead(403);
        res.end('Access denied');
        return;
      }

      // Hold the lease for as long as this response is open, and register
      // the release before any await so an aborted request still frees it.
      lease.activeRequests += 1;
      res.once('close', () => {
        lease.activeRequests -= 1;
        lease.expiresAt = Date.now() + TOKEN_IDLE_TTL_MS;
      });

      // Expected URL: /stream/:fileId with an optional extension.
      const fileId = STREAM_PATH.exec(urlObj.pathname)?.[1];
      if (!fileId) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      if (fileId !== lease.fileId) {
        res.writeHead(403);
        res.end('Access denied');
        return;
      }

      // [SECURITY] IDOR Prevention
      // Verify that the requested file ID corresponds to a file that is actually in our library.
      const isAllowed = await isFileInLibrary(`gdrive://${fileId}`);
      if (!isAllowed) {
        console.warn(
          `[InternalProxy] Blocked access to unauthorized Drive file: ${fileId}`,
        );
        res.writeHead(403);
        res.end('Access denied');
        return;
      }

      const meta = await getDriveFileMetadataCached(fileId);
      const totalSize = parseDriveFileSize(meta);
      const mimeType = meta.mimeType || 'application/octet-stream';

      const range = parseHttpRange(totalSize, req.headers.range);
      if (range.error) {
        res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
        res.end('Requested range not satisfiable.');
        return;
      }

      const { stream, length } = await getDriveStreamWithCache(fileId, {
        start: range.start,
        end: range.end,
      });

      // ffmpeg may have closed the connection while we were waiting.
      if (res.destroyed) {
        stream.destroy();
        return;
      }

      // Headers are set, not written, so a stream error before the first
      // byte can still be answered with a 500 (see pipeToResponse).
      res.statusCode = range.partial ? 206 : 200;
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', length);
      if (range.partial) {
        res.setHeader(
          'Content-Range',
          `bytes ${range.start}-${range.start + length - 1}/${totalSize}`,
        );
      }

      pipeToResponse(stream, res, 'InternalProxy');
    } catch (err) {
      console.error('[InternalProxy] Request Error:', err);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      } else {
        res.destroy();
      }
    }
  }

  /** Returns the live lease for a token, dropping it if it has expired. */
  private findLease(token: string | null): TokenLease | null {
    if (!token) return null;
    const key = hashToken(token);
    const lease = this.leases.get(key);
    if (!lease) return null;
    if (lease.activeRequests === 0 && lease.expiresAt <= Date.now()) {
      this.leases.delete(key);
      return null;
    }
    return lease;
  }

  private pruneLeases(): void {
    const now = Date.now();
    for (const [key, lease] of this.leases) {
      if (lease.activeRequests === 0 && lease.expiresAt <= now) {
        this.leases.delete(key);
      }
    }
  }

  public static getInstance(): InternalMediaProxy {
    if (!InternalMediaProxy.instance) {
      InternalMediaProxy.instance = new InternalMediaProxy();
    }
    return InternalMediaProxy.instance;
  }

  public async start(): Promise<void> {
    if (this.isListening) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = new Promise<void>((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as AddressInfo;
        this.port = addr.port;
        this.isListening = true;
        console.log(`[InternalMediaProxy] Started on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    }).catch((err: unknown) => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  /**
   * Returns a URL that lets ffmpeg read one Drive file through the proxy.
   * Each call mints a new token that only unlocks `fileId`.
   *
   * @param extension - Optional format hint such as '.mp4'.
   */
  public async getUrlForFile(
    fileId: string,
    extension: string = '',
  ): Promise<string> {
    if (!DRIVE_FILE_ID.test(fileId)) {
      throw new Error('Invalid Drive file ID');
    }
    const suffix = URL_EXTENSION.test(extension) ? extension : '';

    if (!this.isListening) {
      // Lazy start
      await this.start();
    }

    this.pruneLeases();
    const token = crypto.randomBytes(32).toString('hex');
    this.leases.set(hashToken(token), {
      fileId,
      activeRequests: 0,
      expiresAt: Date.now() + TOKEN_IDLE_TTL_MS,
    });
    return `http://127.0.0.1:${this.port}/stream/${fileId}${suffix}?token=${token}`;
  }

  public getPort(): number {
    return this.port;
  }
}
