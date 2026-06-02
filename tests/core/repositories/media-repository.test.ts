import { describe, it, expect, vi } from 'vitest';
import { MediaRepository } from '../../../src/core/database/repositories/media-repository';
import * as database from '../../../src/core/database/database';

vi.mock('../../../src/core/database/database', () => ({
  getMediaDirectories: vi.fn(),
  cacheAlbums: vi.fn(),
  getCachedAlbums: vi.fn(),
  getAllMetadata: vi.fn(),
  getAllMetadataAndStats: vi.fn(),
  getAllMetadataVerification: vi.fn(),
  getMetadata: vi.fn(),
  bulkUpsertMetadata: vi.fn(),
  getPendingMetadata: vi.fn(),
  filterProcessingNeeded: vi.fn(),
  getSetting: vi.fn(),
}));

describe('MediaRepository', () => {
  const repo = new MediaRepository();

  it('delegates getMediaDirectories to database', async () => {
    await repo.getMediaDirectories();
    expect(database.getMediaDirectories).toHaveBeenCalled();
  });

  it('delegates cacheAlbums to database', async () => {
    await repo.cacheAlbums([]);
    expect(database.cacheAlbums).toHaveBeenCalledWith([]);
  });

  it('delegates getCachedAlbums to database', async () => {
    await repo.getCachedAlbums();
    expect(database.getCachedAlbums).toHaveBeenCalled();
  });

  it('delegates getAllMetadata to database', async () => {
    await repo.getAllMetadata();
    expect(database.getAllMetadata).toHaveBeenCalled();
  });

  it('delegates getAllMetadataAndStats to database', async () => {
    await repo.getAllMetadataAndStats();
    expect(database.getAllMetadataAndStats).toHaveBeenCalled();
  });

  it('delegates getAllMetadataVerification to database', async () => {
    await repo.getAllMetadataVerification();
    expect(database.getAllMetadataVerification).toHaveBeenCalled();
  });

  it('delegates getMetadata to database', async () => {
    await repo.getMetadata(['/test']);
    expect(database.getMetadata).toHaveBeenCalledWith(['/test']);
  });

  it('delegates bulkUpsertMetadata to database', async () => {
    await repo.bulkUpsertMetadata([]);
    expect(database.bulkUpsertMetadata).toHaveBeenCalledWith([]);
  });

  it('delegates getPendingMetadata to database', async () => {
    await repo.getPendingMetadata();
    expect(database.getPendingMetadata).toHaveBeenCalled();
  });

  it('delegates filterProcessingNeeded to database', async () => {
    await repo.filterProcessingNeeded(['/test']);
    expect(database.filterProcessingNeeded).toHaveBeenCalledWith(['/test']);
  });

  it('delegates getSetting to database', async () => {
    await repo.getSetting('test');
    expect(database.getSetting).toHaveBeenCalledWith('test');
  });
});
