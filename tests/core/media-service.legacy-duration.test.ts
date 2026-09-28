/**
 * F95: older versions stored a video whose duration probe failed as
 * 'success' with a NULL duration, and nothing ever retried it. These tests
 * seed such a row in a real SQLite database and run the real worker
 * queries under MediaService.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'vite-plus/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import * as worker from '../../src/core/database/database-worker';
import { initializeDatabase } from '../../src/core/database/database-schema';
import { MediaService } from '../../src/core/media/media-service';
import { NodeFileSystem } from '../../src/infrastructure/node-file-system';
import type { IMediaRepository } from '../../src/core/database/repositories/media-repository.interface';
import type { IMediaHandler } from '../../src/core/media/interfaces/media-handler.interface';
import type { Album, MediaMetadata } from '../../src/core/media/types';

// The worker module registers a parentPort listener on import.
vi.mock('worker_threads', () => ({
  parentPort: { on: vi.fn(), postMessage: vi.fn() },
  default: {},
}));

const CACHE_KEY = 'file_index';

async function unwrap<T>(
  result: worker.WorkerResult | Promise<worker.WorkerResult>,
): Promise<T> {
  const { success, data, error } = await result;
  if (!success) throw new Error(error);
  return data as T;
}

/** IMediaRepository over the real worker functions (no worker thread). */
function workerRepository(sources: string[]): IMediaRepository {
  return {
    getMediaDirectories: async () =>
      sources.map((p) => ({
        id: p,
        path: p,
        type: 'local' as const,
        name: p,
        isActive: true,
      })),
    repairDriveSourceName: async () => {},
    cacheAlbums: (albums) => unwrap(worker.cacheAlbums(CACHE_KEY, albums)),
    getCachedAlbums: () => unwrap(worker.getCachedAlbums(CACHE_KEY)),
    getAllMetadata: () => unwrap(worker.getAllMetadata()),
    getAllMetadataAndStats: async () => [],
    getAllMetadataVerification: async () => {
      const rows = await unwrap<({ filePath: string } & MediaMetadata)[]>(
        worker.getAllMetadataVerification(),
      );
      return Object.fromEntries(rows.map((r) => [r.filePath, r]));
    },
    getMetadata: (filePaths) => unwrap(worker.getMetadata(filePaths)),
    bulkUpsertMetadata: (data) => unwrap(worker.bulkUpsertMetadata(data)),
    getPendingMetadata: async () => [],
    filterProcessingNeeded: (filePaths) =>
      unwrap(worker.filterProcessingNeeded(filePaths)),
    getSetting: (key) => unwrap(worker.getSetting(key)),
    saveSetting: (key, value) => unwrap(worker.saveSetting(key, value)),
  };
}

describe('F95: legacy success rows without a duration (existing database)', () => {
  let dir: string;
  let dbPath: string;
  let clip: string;
  let photo: string;
  let measured: string;
  let getVideoDuration: Mock<IMediaHandler['getVideoDuration']>;
  let service: MediaService;

  /** Seeds rows exactly as the old code stored them, then closes the DB. */
  const seedLegacyRows = async () => {
    const legacy = new DatabaseSync(dbPath);
    initializeDatabase(legacy);
    const insert = legacy.prepare(
      `INSERT INTO media_metadata (file_path_hash, file_path, duration, size, created_at, extraction_status, in_library)
       VALUES (?, ?, ?, ?, ?, 'success', 1)`,
    );
    for (const [id, filePath, duration] of [
      ['clip', clip, null],
      ['photo', photo, null],
      ['measured', measured, 30],
    ] as const) {
      // Size and creation time match the file, so only the missing
      // duration can send the row back through extraction.
      const stats = await fs.stat(filePath);
      insert.run(
        id,
        filePath,
        duration,
        stats.size,
        stats.birthtime.toISOString(),
      );
    }
    legacy.close();
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-duration-'));
    dbPath = path.join(dir, 'library.db');
    clip = path.join(dir, 'media', 'clip.mp4');
    photo = path.join(dir, 'media', 'photo.jpg');
    measured = path.join(dir, 'media', 'measured.mkv');
    await fs.mkdir(path.dirname(clip), { recursive: true });
    await fs.writeFile(clip, 'video bytes');
    await fs.writeFile(photo, 'photo bytes');
    await fs.writeFile(measured, 'other video bytes');
    await seedLegacyRows();
    expect(worker.initDatabase(dbPath).success).toBe(true);
    // Scans only keep (and grant membership to) roots of active sources.
    const source = path.dirname(clip);
    expect(worker.addMediaDirectory({ path: source }).success).toBe(true);

    getVideoDuration = vi
      .fn<IMediaHandler['getVideoDuration']>()
      .mockResolvedValue({ duration: 42 });
    const albums: Album[] = [
      {
        // The scanner ids a local root album by its directory path.
        id: source,
        name: 'media',
        textures: [clip, photo, measured].map((p) => ({
          name: path.basename(p),
          path: p,
        })),
        children: [],
      },
    ];
    service = new MediaService(
      workerRepository([source]),
      new NodeFileSystem(),
      { runScan: vi.fn().mockResolvedValue(albums) },
      { getVideoDuration, getFileMetadata: vi.fn() },
    );
  });

  afterEach(async () => {
    worker.closeDatabase();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('puts the video back in the retry set, and only the video', async () => {
    const needed = await unwrap<string[]>(
      worker.filterProcessingNeeded([clip, photo, measured]),
    );
    expect(needed).toEqual([clip]);

    // The >1000-file path reads durations too, so it can tell the same.
    const rows = await unwrap<{ filePath: string; duration: unknown }[]>(
      worker.getAllMetadataVerification(),
    );
    expect(rows.find((r) => r.filePath === clip)?.duration).toBeNull();
    expect(rows.find((r) => r.filePath === measured)?.duration).toBe(30);
  });

  it('re-probes the video on the next scan and stores its duration', async () => {
    await service.scanDiskForAlbumsAndCache('/ffmpeg');

    await vi.waitFor(async () => {
      const meta = await unwrap<Record<string, MediaMetadata>>(
        worker.getMetadata([clip]),
      );
      expect(meta[clip]).toMatchObject({ status: 'success', duration: 42 });
    });
    expect(getVideoDuration).toHaveBeenCalledTimes(1);
    expect(getVideoDuration).toHaveBeenCalledWith(clip, '/ffmpeg');

    // Healed: later scans leave it alone.
    expect(
      await unwrap<string[]>(worker.filterProcessingNeeded([clip])),
    ).toEqual([]);
    await service.scanDiskForAlbumsAndCache('/ffmpeg');
    await new Promise((r) => setTimeout(r, 20));
    expect(getVideoDuration).toHaveBeenCalledTimes(1);
  });

  it('re-probes it on an explicit request as well', async () => {
    await service.extractAndSaveMetadata([clip, measured], '/ffmpeg', {
      forceCheck: true,
    });

    // The unchanged, complete video is still skipped.
    expect(getVideoDuration).toHaveBeenCalledTimes(1);
    expect(getVideoDuration).toHaveBeenCalledWith(clip, '/ffmpeg');
    const meta = await unwrap<Record<string, MediaMetadata>>(
      worker.getMetadata([clip, measured]),
    );
    expect(meta[clip]?.duration).toBe(42);
    expect(meta[measured]?.duration).toBe(30);
  });
});
