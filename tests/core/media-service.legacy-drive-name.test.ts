/**
 * F93: older web-mode builds stored a Drive source as { type: 'local',
 * name: <folder ID> }. The type is repaired when the row is read; these
 * tests check that a scan also gives such a row the Drive folder's real
 * name, using a real SQLite database and the real worker queries.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vite-plus/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import * as worker from '../../src/core/database/database-worker';
import { initializeDatabase } from '../../src/core/database/database-schema';
import { MediaService } from '../../src/core/media/media-service';
import type { IMediaRepository } from '../../src/core/database/repositories/media-repository.interface';
import type { Album, MediaDirectory } from '../../src/core/media/types';

// The worker module registers a parentPort listener on import.
vi.mock('worker_threads', () => ({
  parentPort: { on: vi.fn(), postMessage: vi.fn() },
  default: {},
}));

const CACHE_KEY = 'file_index';
const FOLDER_ID = '1AbCdEfGhIjKlMnOp';
const SOURCE = `gdrive://${FOLDER_ID}`;

async function unwrap<T>(
  result: worker.WorkerResult | Promise<worker.WorkerResult>,
): Promise<T> {
  const { success, data, error } = await result;
  if (!success) throw new Error(error);
  return data as T;
}

/** IMediaRepository over the real worker functions (no worker thread). */
function workerRepository(): IMediaRepository {
  return {
    getMediaDirectories: () =>
      unwrap<MediaDirectory[]>(worker.getMediaDirectories()),
    repairDriveSourceName: async (directoryPath, name) => {
      await unwrap(worker.repairDriveSourceName(directoryPath, name));
    },
    cacheAlbums: (albums) => unwrap(worker.cacheAlbums(CACHE_KEY, albums)),
    getCachedAlbums: () => unwrap(worker.getCachedAlbums(CACHE_KEY)),
    getAllMetadata: async () => ({}),
    getAllMetadataAndStats: async () => [],
    getAllMetadataVerification: async () => ({}),
    getMetadata: async () => ({}),
    bulkUpsertMetadata: async () => {},
    getPendingMetadata: async () => [],
    filterProcessingNeeded: async () => [],
    getSetting: (key) => unwrap(worker.getSetting(key)),
    saveSetting: (key, value) => unwrap(worker.saveSetting(key, value)),
  };
}

/** A Drive root album as listDriveFiles returns it. */
const driveAlbum = (id: string, name: string): Album => ({
  id,
  name,
  textures: [{ name: 'a.jpg', path: 'gdrive://file-a' }],
  children: [],
});

describe('F93: legacy Drive source names', () => {
  let dir: string;
  let dbPath: string;
  let runScan: ReturnType<typeof vi.fn>;
  let repo: IMediaRepository;
  let service: MediaService;

  /** Inserts source rows exactly as the given build stored them. */
  const seedSources = (
    rows: { path: string; type: string; name: string; isActive?: boolean }[],
  ) => {
    const legacy = new DatabaseSync(dbPath);
    initializeDatabase(legacy);
    const insert = legacy.prepare(
      'INSERT INTO media_directories (id, path, type, name, is_active) VALUES (?, ?, ?, ?, ?)',
    );
    for (const row of rows) {
      insert.run(
        crypto.randomUUID(),
        row.path,
        row.type,
        row.name,
        row.isActive === false ? 0 : 1,
      );
    }
    legacy.close();
    expect(worker.initDatabase(dbPath).success).toBe(true);
  };

  const storedSources = () =>
    unwrap<MediaDirectory[]>(worker.getMediaDirectories());

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-drive-name-'));
    dbPath = path.join(dir, 'library.db');
    runScan = vi.fn();
    repo = workerRepository();
    service = new MediaService(repo, {} as any, { runScan } as any, {} as any);
  });

  afterEach(async () => {
    worker.closeDatabase();
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('names a legacy row after the scanned Drive folder', async () => {
    seedSources([{ path: SOURCE, type: 'local', name: FOLDER_ID }]);
    expect((await storedSources())[0]).toMatchObject({
      type: 'google_drive',
      name: FOLDER_ID,
    });
    runScan.mockResolvedValue([driveAlbum(FOLDER_ID, 'Holidays 2024')]);

    await service.scanDiskForAlbumsAndCache();

    expect(await storedSources()).toEqual([
      expect.objectContaining({
        path: SOURCE,
        type: 'google_drive',
        name: 'Holidays 2024',
        isActive: true,
      }),
    ]);
  });

  it("names a legacy 'root' source after My Drive", async () => {
    seedSources([{ path: 'gdrive://root', type: 'local', name: 'root' }]);
    runScan.mockResolvedValue([driveAlbum('root', 'My Drive')]);

    await service.scanDiskForAlbumsAndCache();

    expect((await storedSources())[0]?.name).toBe('My Drive');
  });

  it('keeps a name the source already has', async () => {
    seedSources([
      { path: SOURCE, type: 'google_drive', name: 'Family photos' },
      { path: '/media/1AbC', type: 'local', name: '1AbC' },
    ]);
    runScan.mockResolvedValue([
      driveAlbum(FOLDER_ID, 'Holidays 2024'),
      { ...driveAlbum('/media/1AbC', '1AbC'), textures: [] },
    ]);

    await service.scanDiskForAlbumsAndCache();

    const names = (await storedSources()).map((d) => [d.path, d.name]);
    expect(names).toEqual([
      [SOURCE, 'Family photos'],
      ['/media/1AbC', '1AbC'],
    ]);
  });

  it('leaves the name alone when the folder could not be scanned', async () => {
    seedSources([{ path: SOURCE, type: 'local', name: FOLDER_ID }]);
    runScan.mockResolvedValue([]);

    await service.scanDiskForAlbumsAndCache();

    expect((await storedSources())[0]?.name).toBe(FOLDER_ID);
  });

  it('keeps the scan result when the rename fails', async () => {
    seedSources([{ path: SOURCE, type: 'local', name: FOLDER_ID }]);
    const albums = [driveAlbum(FOLDER_ID, 'Holidays 2024')];
    runScan.mockResolvedValue(albums);
    vi.spyOn(repo, 'repairDriveSourceName').mockRejectedValue(
      new Error('database is locked'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(service.scanDiskForAlbumsAndCache()).resolves.toEqual(albums);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to rename Drive source ${SOURCE}`),
      expect.any(Error),
    );
    expect((await storedSources())[0]?.name).toBe(FOLDER_ID);
  });

  describe('worker repairDriveSourceName', () => {
    it('only renames a Drive row still named after its ID', async () => {
      seedSources([
        { path: SOURCE, type: 'local', name: FOLDER_ID },
        { path: 'gdrive://named', type: 'google_drive', name: 'Mine' },
      ]);

      expect(
        await unwrap(worker.repairDriveSourceName(SOURCE, 'Holidays')),
      ).toBe(true);
      expect(
        await unwrap(worker.repairDriveSourceName('gdrive://named', 'Other')),
      ).toBe(false);
      expect(
        await unwrap(worker.repairDriveSourceName('/local/path', 'x')),
      ).toBe(false);
      expect(await unwrap(worker.repairDriveSourceName(SOURCE, ''))).toBe(
        false,
      );

      expect((await storedSources()).map((d) => d.name)).toEqual([
        'Holidays',
        'Mine',
      ]);
    });

    it('fails when the database is not open', () => {
      expect(worker.repairDriveSourceName(SOURCE, 'Holidays')).toEqual({
        success: false,
        error: 'Database not initialized',
      });
    });
  });
});
