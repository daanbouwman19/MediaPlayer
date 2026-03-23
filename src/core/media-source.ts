import fs from 'fs';

import { Readable } from 'stream';
import { getDriveFileMetadata } from '../main/google-drive-service.ts';
import { getDriveStreamWithCache } from './drive-stream.ts';
import { authorizeFilePath } from './security.ts';
import type { AuthorizationResult } from './security.ts';
import { InternalMediaProxy } from './media-proxy.ts';
import type { IMediaSource } from './media-source-types.ts';
import { isDrivePath, getDriveId } from './media-utils.ts';
import { getMimeType } from './utils/mime-types.ts';

export class LocalMediaSource implements IMediaSource {
  private authResult: Promise<AuthorizationResult> | undefined;
  private statsPromise: Promise<fs.Stats> | undefined;

  constructor(private filePath: string) {}

  private async ensureAuthorized(): Promise<string> {
    if (!this.authResult) {
      this.authResult = authorizeFilePath(this.filePath);
    }
    const auth = await this.authResult;
    if (!auth.isAllowed || !auth.realPath) {
      throw new Error(auth.message || 'Access denied');
    }
    return auth.realPath;
  }

  private async ensureStats(): Promise<fs.Stats> {
    if (!this.statsPromise) {
      this.statsPromise = (async () => {
        const realPath = await this.ensureAuthorized();
        return fs.promises.stat(realPath);
      })();
    }
    return this.statsPromise;
  }

  async getFFmpegInput(): Promise<string> {
    const realPath = await this.ensureAuthorized();
    return realPath;
  }

  async getStream(range?: {
    start: number;
    end: number;
  }): Promise<{ stream: Readable; length: number }> {
    const realPath = await this.ensureAuthorized();

    const options: { start?: number; end?: number } = {};
    if (range) {
      options.start = range.start;
      options.end = range.end;
    }

    // Check stats after auth (cached)
    const stats = await this.ensureStats();
    const start = options.start || 0;
    const end = options.end !== undefined ? options.end : stats.size - 1;

    // Validate range
    if (start > end || start >= stats.size) {
      throw new Error(
        `Invalid range requested: start=${start}, end=${end}, size=${stats.size}`,
      );
    }

    const length = end - start + 1;
    const stream = fs.createReadStream(realPath, options);

    return { stream, length };
  }

  async getMimeType(): Promise<string> {
    await this.ensureAuthorized();
    return getMimeType(this.filePath);
  }

  async getSize(): Promise<number> {
    const stats = await this.ensureStats();
    return stats.size;
  }
}

export class DriveMediaSource implements IMediaSource {
  private fileId: string;
  private metadataPromise:
    | Promise<import('googleapis').drive_v3.Schema$File>
    | undefined;

  constructor(filePath: string) {
    this.fileId = getDriveId(filePath);
  }

  private ensureMetadata(): Promise<import('googleapis').drive_v3.Schema$File> {
    if (!this.metadataPromise) {
      this.metadataPromise = getDriveFileMetadata(this.fileId);
    }
    return this.metadataPromise;
  }

  async getFFmpegInput(): Promise<string> {
    let ext = '';
    try {
      const meta = await this.ensureMetadata();
      if (meta.name) {
        const lastDot = meta.name.lastIndexOf('.');
        if (lastDot !== -1) {
          ext = meta.name.substring(lastDot); // includes dot
        }
      }
    } catch (e) {
      console.warn('Failed to resolve extension for Drive file input', e);
    }

    return await InternalMediaProxy.getInstance().getUrlForFile(
      this.fileId,
      ext,
    );
  }

  async getStream(range?: {
    start: number;
    end: number;
  }): Promise<{ stream: Readable; length: number }> {
    return getDriveStreamWithCache(this.fileId, range);
  }

  async getMimeType(): Promise<string> {
    try {
      const meta = await this.ensureMetadata();
      return meta.mimeType || 'application/octet-stream';
    } catch {
      return 'application/octet-stream';
    }
  }

  async getSize(): Promise<number> {
    const meta = await this.ensureMetadata();
    return Number(meta.size);
  }
}

export function createMediaSource(filePath: string): IMediaSource {
  if (isDrivePath(filePath)) {
    return new DriveMediaSource(filePath);
  }
  return new LocalMediaSource(filePath);
}
