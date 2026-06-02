import http from 'http';
import crypto from 'crypto';
import { AddressInfo } from 'net';
import { getDriveFileMetadata } from '../../main/google-drive-service.ts';
import { getDriveStreamWithCache } from './drive-stream.ts';
import { parseHttpRange } from '../network/http-utils.ts';
import { isFileInLibrary } from '../database/database.ts';

export class InternalMediaProxy {
  private static instance: InternalMediaProxy;
  private server: http.Server;
  private port: number = 0;
  private isListening: boolean = false;
  private authToken: string;

  private constructor() {
    this.authToken = crypto.randomBytes(32).toString('hex');
    this.server = http.createServer(async (req, res) => {
      try {
        const url = req.url || '';
        const urlObj = new URL(
          url,
          `http://${req.headers.host || 'localhost'}`,
        );
        const token = urlObj.searchParams.get('token');

        const serverTokenBuffer = Buffer.from(this.authToken, 'hex');
        const userTokenBuffer = Buffer.alloc(serverTokenBuffer.length);

        if (token) {
          try {
            userTokenBuffer.write(token, 'hex');
          } catch {
            // Ignore write errors; userTokenBuffer remains zero-filled/partial
            // causing timingSafeEqual to return false safely.
          }
        }

        if (!crypto.timingSafeEqual(userTokenBuffer, serverTokenBuffer)) {
          res.writeHead(403);
          res.end('Access denied');
          return;
        }

        // Expected URL: /stream/:fileId (optional extension)
        // Capture only the ID (Base64url characters)
        const match = urlObj.pathname.match(/^\/stream\/([a-zA-Z0-9_\-]+)/);

        if (!match) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const fileId = match[1];

        // [SECURITY] IDOR Prevention
        // Verify that the requested file ID corresponds to a file that is actually in our library.
        // This prevents an attacker with a valid token from accessing arbitrary Drive files
        // by guessing or knowing their IDs.
        const isAllowed = await isFileInLibrary(`gdrive://${fileId}`);
        if (!isAllowed) {
          console.warn(
            `[InternalProxy] Blocked access to unauthorized Drive file: ${fileId}`,
          );
          res.writeHead(403);
          res.end('Access denied');
          return;
        }

        const meta = await getDriveFileMetadata(fileId);
        const totalSize = Number(meta.size);
        const mimeType = meta.mimeType || 'application/octet-stream';

        // Handle Range requests
        const rangeHeader = req.headers.range;

        const { start, end, error } = parseHttpRange(totalSize, rangeHeader);

        if (error) {
          res.writeHead(416, { 'Content-Range': `bytes */${totalSize}` });
          return res.end('Requested range not satisfiable.');
        }

        const { stream, length } = await getDriveStreamWithCache(fileId, {
          start,
          end,
        });

        // Calculate the actual end byte being served based on the length returned
        const actualEnd = start + length - 1;

        res.writeHead(206, {
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${actualEnd}/${totalSize}`,
          'Content-Length': length,
        });

        stream.pipe(res);

        stream.on('error', (err: unknown) => {
          console.error('[InternalProxy] Stream Error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });

        req.on('close', () => {
          stream.destroy();
        });
      } catch (err) {
        console.error('[InternalProxy] Request Error:', err);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      }
    });
  }

  public static getInstance(): InternalMediaProxy {
    if (!InternalMediaProxy.instance) {
      InternalMediaProxy.instance = new InternalMediaProxy();
    }
    return InternalMediaProxy.instance;
  }

  public async start(): Promise<void> {
    if (this.isListening) return;

    return new Promise((resolve, reject) => {
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
    });
  }

  public getUrlForFile(
    fileId: string,
    extension: string = '',
  ): Promise<string> {
    const buildUrl = () =>
      `http://127.0.0.1:${this.port}/stream/${fileId}${extension}?token=${this.authToken}`;

    if (!this.isListening) {
      // Lazy start
      return this.start().then(buildUrl);
    }
    return Promise.resolve(buildUrl());
  }

  public getPort(): number {
    return this.port;
  }
}
