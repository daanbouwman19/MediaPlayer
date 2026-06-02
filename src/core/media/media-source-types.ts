import { Readable } from 'stream';

/**
 * Interface representing a media source.
 * Provides access to the raw stream and an FFmpeg-compatible input string.
 */
export interface IMediaSource {
  /**
   * Returns a string suitable for passing to FFmpeg's `-i` flag.
   * - Local files: returns the absolute file path.
   * - Drive files: returns a URL to the internal media proxy.
   */
  getFFmpegInput(): Promise<string>;

  /**
   * Returns a readable stream of the file content.
   * Used for Direct Play or by the Internal Media Proxy.
   * @param range Optional byte range.
   * @returns An object containing the stream and the length of the content being served.
   */
  getStream(range?: {
    start: number;
    end: number;
  }): Promise<{ stream: Readable; length: number }>;

  /**
   * Returns the MIME type of the file.
   */
  getMimeType(): Promise<string>;

  /**
   * Returns the total size of the file in bytes.
   */
  getSize(): Promise<number>;
}
