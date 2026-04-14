import { IMediaRepository } from '../../src/core/repositories/media-repository.interface.ts';
import type {
  Album,
  MediaMetadata,
  MediaLibraryItem,
  MediaDirectory,
} from '../../src/core/types.ts';

export class InMemoryMediaRepository implements IMediaRepository {
  private albums: Album[] | null = null;
  private metadata: Map<string, MediaMetadata> = new Map();
  private stats: MediaLibraryItem[] = [];
  private settings: Map<string, string> = new Map();
  private directories: MediaDirectory[] = [];

  async getMediaDirectories() {
    return this.directories;
  }

  setMediaDirectories(directories: MediaDirectory[]) {
    this.directories = directories;
  }

  async cacheAlbums(albums: Album[]) {
    this.albums = albums;
  }

  async getCachedAlbums() {
    return this.albums;
  }

  async getAllMetadata() {
    const result: { [path: string]: MediaMetadata } = {};
    for (const [path, meta] of this.metadata.entries()) {
      result[path] = meta;
    }
    return result;
  }

  async getAllMetadataAndStats() {
    return this.stats;
  }

  setAllMetadataAndStats(stats: MediaLibraryItem[]) {
    this.stats = stats;
  }

  async getAllMetadataVerification() {
    return this.getAllMetadata();
  }

  async getMetadata(filePaths: string[]) {
    const result: { [path: string]: MediaMetadata } = {};
    for (const path of filePaths) {
      const meta = this.metadata.get(path);
      if (meta) {
        result[path] = meta;
      }
    }
    return result;
  }

  async bulkUpsertMetadata(data: Array<{ filePath: string } & MediaMetadata>) {
    for (const item of data) {
      const { filePath, ...meta } = item;
      this.metadata.set(filePath, meta);
    }
  }

  async getPendingMetadata() {
    const pending: string[] = [];
    for (const [path, meta] of this.metadata.entries()) {
      if (meta.status === 'processing' || meta.status === 'failed') {
        pending.push(path);
      }
    }
    return pending;
  }

  async filterProcessingNeeded(filePaths: string[]) {
    return filePaths.filter((path) => {
      const meta = this.metadata.get(path);
      return !meta || meta.status !== 'success';
    });
  }

  async getSetting(key: string) {
    return this.settings.get(key) || null;
  }

  setSetting(key: string, value: string) {
    this.settings.set(key, value);
  }
}
