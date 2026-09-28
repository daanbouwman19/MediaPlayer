/**
 * @file Repository for media-related database operations.
 */
import {
  cacheAlbums,
  getAllMetadata,
  getAllMetadataAndStats,
  getAllMetadataVerification,
  getCachedAlbums,
  readMediaDirectories,
  repairDriveSourceName,
  getMetadata,
  getPendingMetadata,
  getSetting,
  saveSetting,
  bulkUpsertMetadata,
  filterProcessingNeeded,
} from '../database.ts';
import type { Album, MediaMetadata } from '../../media/types.ts';
import { IMediaRepository } from './media-repository.interface.ts';

export class MediaRepository implements IMediaRepository {
  async getMediaDirectories() {
    // Scans must see read failures rather than an empty source list.
    return readMediaDirectories();
  }

  async repairDriveSourceName(directoryPath: string, name: string) {
    return repairDriveSourceName(directoryPath, name);
  }

  async cacheAlbums(albums: Album[]) {
    // Rethrows so scans know whether the tree was stored before stamping it,
    // and always invalidates the auth cache: membership authorizes gdrive://.
    return cacheAlbums(albums);
  }

  async getCachedAlbums() {
    return getCachedAlbums();
  }

  async getAllMetadata() {
    return getAllMetadata();
  }

  async getAllMetadataAndStats() {
    return getAllMetadataAndStats();
  }

  async getAllMetadataVerification() {
    return getAllMetadataVerification();
  }

  async getMetadata(filePaths: string[]) {
    return getMetadata(filePaths);
  }

  async bulkUpsertMetadata(data: Array<{ filePath: string } & MediaMetadata>) {
    return bulkUpsertMetadata(data);
  }

  async getPendingMetadata() {
    return getPendingMetadata();
  }

  async filterProcessingNeeded(filePaths: string[]) {
    return filterProcessingNeeded(filePaths);
  }

  async getSetting(key: string) {
    return getSetting(key);
  }

  async saveSetting(key: string, value: string) {
    return saveSetting(key, value);
  }
}
