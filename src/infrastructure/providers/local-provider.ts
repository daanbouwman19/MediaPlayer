import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { FileSystemProvider, FileMetadata } from '../../core/media/fs-provider';
import { FileSystemEntry, listDirectory } from '../../core/media/file-system';
import { isDrivePath } from '../../core/media/media-utils';
import { getMimeType } from '../../core/media/utils/mime-types';

/**
 * Rejects paths with a NUL byte or a `..` segment. Only whole segments
 * count, so names such as 'Holiday...2023.jpg' stay valid.
 */
function assertSafePath(filePath: unknown): asserts filePath is string {
  if (
    typeof filePath !== 'string' ||
    filePath.includes('\0') ||
    filePath.split(/[\\/]/).includes('..')
  ) {
    throw new Error('Invalid file path');
  }
}

export class LocalFileSystemProvider implements FileSystemProvider {
  canHandle(filePath: string): boolean {
    return !isDrivePath(filePath);
  }

  async listDirectory(directoryPath: string): Promise<FileSystemEntry[]> {
    return listDirectory(directoryPath);
  }

  async getMetadata(filePath: string): Promise<FileMetadata> {
    assertSafePath(filePath);
    const absolutePath = path.resolve(filePath);
    const stats = await fsPromises.stat(absolutePath);
    const mimeType = getMimeType(absolutePath);
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
    assertSafePath(filePath);
    const absolutePath = path.resolve(filePath);
    return { stream: fs.createReadStream(absolutePath, options) };
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

  async getThumbnailStream(_filePath: string): Promise<Readable | null> {
    return null;
  }
}
