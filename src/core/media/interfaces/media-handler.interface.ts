import type { FileMetadata } from '../fs-provider.ts';

export interface IMediaHandler {
  getVideoDuration(
    filePath: string,
    ffmpegPath: string,
  ): Promise<{ duration: number } | { error: string }>;

  /**
   * Reads provider metadata (size, MIME type, creation time and, for videos,
   * duration) without downloading the file. Used for Google Drive files,
   * which ffmpeg can't probe by path.
   */
  getFileMetadata(filePath: string): Promise<FileMetadata>;
}
