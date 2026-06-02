import type {
  Album,
  MediaMetadata,
  MediaLibraryItem,
  MediaDirectory,
} from '../../media/types.ts';

export interface IMediaRepository {
  getMediaDirectories(): Promise<MediaDirectory[]>;
  cacheAlbums(albums: Album[]): Promise<void>;
  getCachedAlbums(): Promise<Album[] | null>;
  getAllMetadata(): Promise<{ [path: string]: MediaMetadata }>;
  getAllMetadataAndStats(): Promise<MediaLibraryItem[]>;
  getAllMetadataVerification(): Promise<{ [path: string]: MediaMetadata }>;
  getMetadata(filePaths: string[]): Promise<{ [path: string]: MediaMetadata }>;
  bulkUpsertMetadata(
    data: Array<{ filePath: string } & MediaMetadata>,
  ): Promise<void>;
  getPendingMetadata(): Promise<string[]>;
  filterProcessingNeeded(filePaths: string[]): Promise<string[]>;
  getSetting(key: string): Promise<string | null>;
}
