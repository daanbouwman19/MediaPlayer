import type {
  Album,
  MediaMetadata,
  MediaLibraryItem,
  MediaDirectory,
} from '../../media/types.ts';

export interface IMediaRepository {
  /**
   * Reads the configured media sources. Rejects when they can't be read, so
   * a scan never mistakes a database failure for "no sources".
   */
  getMediaDirectories(): Promise<MediaDirectory[]>;
  /**
   * Gives a Drive source whose stored name is still its bare folder ID (as
   * older web-mode builds saved it) the folder's real name. Any other name
   * is kept.
   */
  repairDriveSourceName(directoryPath: string, name: string): Promise<void>;
  /**
   * Replaces the cached album tree. Rejects when the write fails or times
   * out, so a scan never marks a tree it didn't store as current.
   */
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
  saveSetting(key: string, value: string): Promise<void>;
}
