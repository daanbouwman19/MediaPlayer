import { Readable } from 'stream';
import { FileSystemEntry } from './file-system.ts';

export { FileSystemEntry };

export interface FileMetadata {
  size: number;
  mimeType: string;
  lastModified?: Date;
  duration?: number; // In seconds
}

export interface FileSystemProvider {
  /**
   * Determines if this provider handles the given path scheme.
   */
  canHandle(path: string): boolean;

  /**
   * Lists the contents of a directory.
   */
  listDirectory(path: string): Promise<FileSystemEntry[]>;

  /**
   * Retrieves metadata for a file.
   */
  getMetadata(path: string): Promise<FileMetadata>;

  /**
   * Returns a readable stream of the file content.
   */
  getStream(
    path: string,
    options?: { start?: number; end?: number },
  ): Promise<{ stream: Readable; length?: number }>;

  /**
   * Gets the parent directory path.
   */
  getParent(path: string): Promise<string | null>;

  /**
   * Resolves the path to a canonical form (e.g. realpath).
   */
  resolvePath(path: string): Promise<string>;

  /**
   * Gets a thumbnail stream for the file.
   * Returns null if not supported/available.
   */
  getThumbnailStream(path: string): Promise<Readable | null>;
}
