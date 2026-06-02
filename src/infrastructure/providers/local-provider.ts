import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { FileSystemProvider, FileMetadata } from '../../core/media/fs-provider';
import { FileSystemEntry, listDirectory } from '../../core/media/file-system';
import { isDrivePath } from '../../core/media/media-utils';
import { getMimeType } from '../../core/media/utils/mime-types';

export class LocalFileSystemProvider implements FileSystemProvider {
  canHandle(filePath: string): boolean {
    return !isDrivePath(filePath);
  }

  async listDirectory(directoryPath: string): Promise<FileSystemEntry[]> {
    return listDirectory(directoryPath);
  }

  async getMetadata(filePath: string): Promise<FileMetadata> {
    if (typeof filePath !== 'string' || filePath.includes('\0')) {
      throw new Error('Invalid file path');
    }
    const stats = await fsPromises.stat(filePath);
    const mimeType = getMimeType(filePath);
    return {
      size: stats.size,
      mimeType,
      lastModified: stats.mtime,
    };
  }

  async getStream(
    filePath: string,
    options?: { start?: number; end?: number },
  ): Promise<{ stream: Readable; length?: number }> {
    if (typeof filePath !== 'string' || filePath.includes('\0')) {
      throw new Error('Invalid file path');
    }
    return { stream: fs.createReadStream(filePath, options) };
  }

  async getParent(filePath: string): Promise<string | null> {
    if (!filePath) return null;
    const parent = path.dirname(filePath);
    if (parent === filePath) return null;
    return parent;
  }

  async resolvePath(filePath: string): Promise<string> {
    try {
      return await fsPromises.realpath(filePath);
    } catch {
      return path.resolve(filePath);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getThumbnailStream(_filePath: string): Promise<Readable | null> {
    return null;
  }
}
