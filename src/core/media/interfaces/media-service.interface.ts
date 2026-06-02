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
}
