import { Readable } from 'stream';
import { FileSystemProvider, FileMetadata } from '../../core/media/fs-provider';
import { FileSystemEntry } from '../../core/media/file-system';
import { getDriveStreamWithCache } from '../../core/media/drive-stream';
import { getDriveFileMetadataCached } from '../../core/media/drive-backend';
import {
  isDrivePath,
  getDriveId,
  createDrivePath,
} from '../../core/media/media-utils';
import {
  listDriveDirectory,
  getDriveParent,
  getDriveFileThumbnail,
} from '../google-drive-service';

export class GoogleDriveProvider implements FileSystemProvider {
  canHandle(filePath: string): boolean {
    return isDrivePath(filePath);
  }

  async listDirectory(directoryPath: string): Promise<FileSystemEntry[]> {
    const folderId = getDriveId(directoryPath) || 'root';
    return listDriveDirectory(folderId);
  }

  async getMetadata(filePath: string): Promise<FileMetadata> {
    const fileId = getDriveId(filePath);
    // Shared with the streaming path, so duration and URL lookups for the
    // same file do not each pay for a files.get round trip.
    const meta = await getDriveFileMetadataCached(fileId);

    let duration: number | undefined;
    if (meta.videoMediaMetadata?.durationMillis) {
      duration = Number(meta.videoMediaMetadata.durationMillis) / 1000;
    }

    return {
      size: Number(meta.size || 0),
      mimeType: meta.mimeType || 'application/octet-stream',
      lastModified: meta.createdTime ? new Date(meta.createdTime) : undefined,
      duration,
    };
  }

  async getStream(
    filePath: string,
    options?: { start?: number; end?: number },
  ): Promise<{ stream: Readable; length?: number }> {
    const fileId = getDriveId(filePath);
    return getDriveStreamWithCache(fileId, options);
  }

  async getParent(filePath: string): Promise<string | null> {
    const fileId = getDriveId(filePath);
    const parentId = await getDriveParent(fileId);
    if (parentId) {
      return createDrivePath(parentId);
    }
    return null;
  }

  async resolvePath(filePath: string): Promise<string> {
    return filePath;
  }

  async getThumbnailStream(filePath: string): Promise<Readable | null> {
    const fileId = getDriveId(filePath);
    try {
      return await getDriveFileThumbnail(fileId);
    } catch {
      return null;
    }
  }
}
