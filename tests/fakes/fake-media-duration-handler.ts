import { IMediaHandler } from '../../src/core/media/interfaces/media-handler.interface';
import type { FileMetadata } from '../../src/core/media/fs-provider';

export class FakeMediaDurationHandler implements IMediaHandler {
  private durations = new Map<string, number>();
  private fileMetadata = new Map<string, FileMetadata>();

  async getVideoDuration(
    filePath: string,
    _ffmpegPath: string,
  ): Promise<{ duration: number } | { error: string }> {
    void _ffmpegPath;
    const duration = this.durations.get(filePath);
    if (duration === undefined) {
      return { duration: 0 };
    }
    return { duration };
  }

  async getFileMetadata(filePath: string): Promise<FileMetadata> {
    const meta = this.fileMetadata.get(filePath);
    if (!meta) {
      throw new Error(`No metadata for ${filePath}`);
    }
    return meta;
  }

  setDuration(filePath: string, duration: number) {
    this.durations.set(filePath, duration);
  }

  setFileMetadata(filePath: string, meta: FileMetadata) {
    this.fileMetadata.set(filePath, meta);
  }
}
