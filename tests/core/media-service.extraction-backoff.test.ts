/**
 * F95: a video that never yields a duration (a corrupt file, or a Drive
 * video Drive never processes) is stored as 'failed'. Scans must back off
 * instead of probing it again on every scan, while explicit client requests
 * (forceCheck) still probe it. Runs the real worker queries on a real
 * SQLite database under MediaService.
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
import { MediaService } from '../../src/core/media/media-service';
import { NodeFileSystem } from '../../src/infrastructure/node-file-system';
import { EXTRACTION_RETRY_BASE_MS } from '../../src/core/media/utils/metadata-status';
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
function workerRepository(source: string): IMediaRepository {
  return {
    getMediaDirectories: async () => [
      { id: source, path: source, type: 'local', name: source, isActive: true },
    ],
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

describe('F95: failed extractions back off between scans', () => {
  let dir: string;
  let dbPath: string;
  let broken: string;
  let getVideoDuration: Mock<IMediaHandler['getVideoDuration']>;
  let service: MediaService;

  /** The stored attempt record of the broken video. */
  const readAttempts = () => {
    const db = new DatabaseSync(dbPath);
    try {
      return db
        .prepare(
          `SELECT extraction_status AS status, extraction_attempts AS attempts,
                  extraction_attempted_at AS attemptedAt
           FROM media_metadata WHERE file_path = ?`,
        )
        .get(broken) as
        | { status: string; attempts: number; attemptedAt: number | null }
        | undefined;
    } finally {
      db.close();
    }
  };

  /** Scans and waits until the background extraction has settled. */
  const scanAndSettle = async (expectedProbes: number) => {
    await service.scanDiskForAlbumsAndCache('/ffmpeg');
    await vi.waitFor(() =>
      expect(getVideoDuration).toHaveBeenCalledTimes(expectedProbes),
    );
    // Give a stray extra probe the chance to show up.
    await new Promise((r) => setTimeout(r, 20));
    expect(getVideoDuration).toHaveBeenCalledTimes(expectedProbes);
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extraction-backoff-'));
    dbPath = path.join(dir, 'library.db');
    const source = path.join(dir, 'media');
    broken = path.join(source, 'broken.mp4');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(broken, 'not really a video');
    expect(worker.initDatabase(dbPath).success).toBe(true);
    expect(worker.addMediaDirectory({ path: source }).success).toBe(true);

    getVideoDuration = vi
      .fn<IMediaHandler['getVideoDuration']>()
      .mockResolvedValue({ error: 'Invalid data found when processing input' });
    const albums: Album[] = [
      {
        id: source,
        name: 'media',
        textures: [{ name: 'broken.mp4', path: broken }],
        children: [],
      },
    ];
    service = new MediaService(
      workerRepository(source),
      new NodeFileSystem(),
      { runScan: vi.fn().mockResolvedValue(albums) },
      { getVideoDuration, getFileMetadata: vi.fn() },
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    worker.closeDatabase();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('does not re-probe a failing video on the next scan within the window', async () => {
    await scanAndSettle(1);
    const first = readAttempts();
    expect(first).toMatchObject({ status: 'failed', attempts: 1 });
    expect(typeof first?.attemptedAt).toBe('number');

    // The next scan (or app launch) leaves it alone.
    await scanAndSettle(1);
    expect(readAttempts()?.attempts).toBe(1);
  });

  it('still probes it when a client asks explicitly (forceCheck)', async () => {
    await scanAndSettle(1);

    await service.extractAndSaveMetadata([broken], '/ffmpeg', {
      forceCheck: true,
    });
    expect(getVideoDuration).toHaveBeenCalledTimes(2);
    expect(readAttempts()?.attempts).toBe(2);
  });

  it('retries once the window has passed, and a success resets the count', async () => {
    await scanAndSettle(1);
    const attemptedAt = readAttempts()?.attemptedAt ?? 0;

    // One hour later the first backoff window is over.
    vi.spyOn(Date, 'now').mockReturnValue(
      attemptedAt + EXTRACTION_RETRY_BASE_MS,
    );
    await scanAndSettle(2);
    expect(readAttempts()?.attempts).toBe(2);

    // Two failures: another hour is not enough any more.
    vi.spyOn(Date, 'now').mockReturnValue(
      attemptedAt + 2 * EXTRACTION_RETRY_BASE_MS,
    );
    await scanAndSettle(2);

    // After the doubled window it is retried, and this time it works.
    vi.spyOn(Date, 'now').mockReturnValue(
      attemptedAt + 4 * EXTRACTION_RETRY_BASE_MS,
    );
    getVideoDuration.mockResolvedValue({ duration: 12 });
    await scanAndSettle(3);
    expect(readAttempts()).toMatchObject({ status: 'success', attempts: 0 });
    const meta = await unwrap<Record<string, MediaMetadata>>(
      worker.getMetadata([broken]),
    );
    expect(meta[broken]?.duration).toBe(12);
  });

  it('writes without a result status keep the attempt record', async () => {
    await scanAndSettle(1);
    const before = readAttempts();

    await unwrap(worker.upsertMetadata({ filePath: broken, rating: 3 }));
    expect(readAttempts()).toEqual(before);
    expect(
      await unwrap<string[]>(worker.filterProcessingNeeded([broken])),
    ).toEqual([]);
  });
});
