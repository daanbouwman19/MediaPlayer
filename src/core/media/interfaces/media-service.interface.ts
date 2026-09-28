import type { Album } from '../types.ts';

export interface IMediaService {
  scanDiskForAlbumsAndCache(ffmpegPath?: string): Promise<Album[]>;
  getAlbumsFromCacheOrDisk(ffmpegPath?: string): Promise<Album[]>;
  getAlbumsWithViewCountsAfterScan(ffmpegPath?: string): Promise<Album[]>;
  getAlbumsWithViewCounts(ffmpegPath?: string): Promise<Album[]>;
  extractAndSaveMetadata(
    filePaths: string[],
    ffmpegPath: string,
    options?: { forceCheck?: boolean },
  ): Promise<void>;
  /**
   * Hands files to the single background extraction job (fire-and-forget).
   * Use this instead of {@link extractAndSaveMetadata} for client requests,
   * so they never run extraction jobs alongside each other or a scan's.
   */
  queueMetadataExtraction(
    filePaths: readonly string[],
    ffmpegPath: string,
    options?: { forceCheck?: boolean },
  ): void;
}
