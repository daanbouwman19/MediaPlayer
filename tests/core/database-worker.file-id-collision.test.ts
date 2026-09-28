/**
 * F37: two copies of a file that share size and mtime used to share one
 * media_metadata row, which flipped between their paths on every scan.
 * These tests run the real worker against a real SQLite file that was
 * written the way the old code wrote it.
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
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  initDatabase,
  closeDatabase,
  bulkUpsertMetadata,
  getMetadata,
  recordMediaView,
  setRating,
  updatePlaybackPosition,
} from '../../src/core/database/database-worker';
import { initializeDatabase } from '../../src/core/database/database-schema';

// The worker module registers a parentPort listener on import.
vi.mock('worker_threads', () => ({
  parentPort: { on: vi.fn(), postMessage: vi.fn() },
  default: {},
}));

/** Scans confirm paths and grant library membership, like cacheAlbums. */
const SCAN = { markInLibrary: true };

const MTIME = new Date('2024-05-01T10:00:00.000Z');

interface Row {
  file_path_hash: string;
  file_path: string | null;
  rating: number | null;
  view_count: number | null;
  playback_position: number | null;
}

/** The ID the pre-fix code computed: md5 of size and mtime. */
async function legacyId(filePath: string): Promise<string> {
  const stats = await fs.stat(filePath);
  return crypto
    .createHash('md5')
    .update(`${stats.size}-${stats.mtime.getTime()}`)
    .digest('hex');
}

describe('database worker: file ID collisions (existing database)', () => {
  let dir: string;
  let dbPath: string;
  let inspector: DatabaseSync | null = null;

  const writeCopy = async (relative: string) => {
    const filePath = path.join(dir, 'media', relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'identical photo bytes');
    await fs.utimes(filePath, MTIME, MTIME);
    return filePath;
  };

  const rows = (): Row[] => {
    inspector ??= new DatabaseSync(dbPath);
    return inspector
      .prepare(
        'SELECT file_path_hash, file_path, rating, view_count, playback_position FROM media_metadata ORDER BY file_path',
      )
      .all() as unknown as Row[];
  };
  const rowFor = (filePath: string) =>
    rows().find((r) => r.file_path === filePath);

  /** Seeds rows exactly as the old code stored them, then closes the DB. */
  const seedLegacyDatabase = (
    seed: {
      id: string;
      filePath: string;
      rating: number;
      views: number;
      position: number;
    }[],
  ) => {
    const legacy = new DatabaseSync(dbPath);
    initializeDatabase(legacy);
    const insert = legacy.prepare(
      `INSERT INTO media_metadata (file_path_hash, file_path, rating, view_count, playback_position, extraction_status, in_library)
       VALUES (?, ?, ?, ?, ?, 'success', 1)`,
    );
    for (const r of seed) {
      insert.run(r.id, r.filePath, r.rating, r.views, r.position);
    }
    legacy.close();
  };

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-id-db-'));
    dbPath = path.join(dir, 'library.db');
  });

  afterEach(async () => {
    inspector?.close();
    inspector = null;
    closeDatabase();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps the existing row on its path and gives the other copy its own row', async () => {
    const trip = await writeCopy('2024/Trip/photo.jpg');
    const favorite = await writeCopy('Favorites/photo.jpg');
    const sharedId = await legacyId(trip);
    expect(await legacyId(favorite)).toBe(sharedId); // the collision

    // The old code left the shared row pointing at whichever copy was
    // written last, carrying the stats of both.
    seedLegacyDatabase([
      { id: sharedId, filePath: trip, rating: 5, views: 3, position: 12 },
    ]);
    expect(initDatabase(dbPath).success).toBe(true);

    // A library scan confirms both paths (the same upsert cacheAlbums runs).
    const scan = () =>
      bulkUpsertMetadata([{ filePath: trip }, { filePath: favorite }], SCAN);
    expect((await scan()).success).toBe(true);

    const tripRow = rowFor(trip);
    const favoriteRow = rowFor(favorite);
    // The existing row, and its ID, are untouched: no data is lost.
    expect(tripRow).toMatchObject({
      file_path_hash: sharedId,
      rating: 5,
      view_count: 3,
      playback_position: 12,
    });
    // The copy gets a separate identity with no borrowed stats.
    expect(favoriteRow).toBeDefined();
    expect(favoriteRow!.file_path_hash).not.toBe(sharedId);
    expect(favoriteRow!.view_count ?? 0).toBe(0);

    // Later scans no longer flip the row between the two paths.
    expect((await scan()).success).toBe(true);
    expect(rowFor(trip)?.file_path_hash).toBe(sharedId);
    expect(rowFor(favorite)?.file_path_hash).toBe(favoriteRow!.file_path_hash);
  });

  it('rates, counts views and saves positions per copy', async () => {
    const trip = await writeCopy('2024/Trip/photo.jpg');
    const favorite = await writeCopy('Favorites/photo.jpg');
    const sharedId = await legacyId(trip);
    seedLegacyDatabase([
      { id: sharedId, filePath: trip, rating: 5, views: 3, position: 12 },
    ]);
    initDatabase(dbPath);
    await bulkUpsertMetadata(
      [{ filePath: trip }, { filePath: favorite }],
      SCAN,
    );

    await setRating(favorite, 2);
    await recordMediaView(favorite);
    await updatePlaybackPosition(favorite, 30);

    expect(rowFor(trip)).toMatchObject({
      rating: 5,
      view_count: 3,
      playback_position: 12,
    });
    expect(rowFor(favorite)).toMatchObject({
      rating: 2,
      view_count: 1,
      playback_position: 30,
    });

    const result = await getMetadata([trip, favorite]);
    const meta = result.data as Record<string, { rating: number }>;
    expect(meta[trip]?.rating).toBe(5);
    expect(meta[favorite]?.rating).toBe(2);
  });

  it('views recorded on a new copy before any scan do not re-point the original', async () => {
    const trip = await writeCopy('2024/Trip/photo.jpg');
    const favorite = await writeCopy('Favorites/photo.jpg');
    const sharedId = await legacyId(trip);
    seedLegacyDatabase([
      { id: sharedId, filePath: trip, rating: 4, views: 7, position: 0 },
    ]);
    initDatabase(dbPath);

    await recordMediaView(favorite);

    expect(rowFor(trip)).toMatchObject({
      file_path_hash: sharedId,
      view_count: 7,
    });
    expect(rowFor(favorite)?.view_count).toBe(1);
  });

  it('leaves non-colliding rows on their existing IDs', async () => {
    const unique = path.join(dir, 'media', 'unique.jpg');
    await fs.mkdir(path.dirname(unique), { recursive: true });
    await fs.writeFile(unique, 'one of a kind');
    const id = await legacyId(unique);
    seedLegacyDatabase([
      { id, filePath: unique, rating: 3, views: 1, position: 0 },
    ]);
    initDatabase(dbPath);

    await bulkUpsertMetadata([{ filePath: unique }], SCAN);
    await setRating(unique, 4);

    expect(rows()).toHaveLength(1);
    expect(rowFor(unique)).toMatchObject({ file_path_hash: id, rating: 4 });
  });

  it('still follows a moved file: stats move with it when the old path is gone', async () => {
    const moved = await writeCopy('new-folder/photo.jpg');
    const id = await legacyId(moved);
    const oldPath = path.join(dir, 'media', 'old-folder', 'photo.jpg');
    seedLegacyDatabase([
      { id, filePath: oldPath, rating: 5, views: 9, position: 40 },
    ]);
    initDatabase(dbPath);

    await bulkUpsertMetadata([{ filePath: moved }], SCAN);

    expect(rows()).toHaveLength(1);
    expect(rowFor(moved)).toMatchObject({
      file_path_hash: id,
      rating: 5,
      view_count: 9,
      playback_position: 40,
    });
  });

  it('keeps two hard links of one file on stable, separate rows', async () => {
    // e.g. rsnapshot / rsync --link-dest snapshots, cp -l, or *arr imports
    // hard-linked into the media folder: both links are scanned.
    const original = await writeCopy('downloads/movie.mp4');
    const link = path.join(dir, 'media', 'library', 'movie.mp4');
    await fs.mkdir(path.dirname(link), { recursive: true });
    try {
      await fs.link(original, link);
    } catch {
      return; // Hard links unsupported on this filesystem.
    }
    const fresh = new DatabaseSync(dbPath);
    initializeDatabase(fresh);
    fresh.close();
    initDatabase(dbPath);

    const scan = () =>
      bulkUpsertMetadata([{ filePath: original }, { filePath: link }], SCAN);
    expect((await scan()).success).toBe(true);
    const first = rows();
    expect(first.map((r) => r.file_path)).toEqual([original, link].sort());
    expect(new Set(first.map((r) => r.file_path_hash)).size).toBe(2);

    // Later scans neither merge the rows nor re-point one between the links.
    expect((await scan()).success).toBe(true);
    expect((await scan()).success).toBe(true);
    expect(rows()).toEqual(first);

    // Each link keeps its own stats.
    await setRating(link, 4);
    const meta = (await getMetadata([original, link])).data as Record<
      string,
      { rating: number | null }
    >;
    expect(meta[link]?.rating).toBe(4);
    expect(meta[original]?.rating ?? 0).toBe(0);
  });

  it('gives a hard link found by a later scan its own row', async () => {
    const original = await writeCopy('downloads/movie.mp4');
    const sharedId = await legacyId(original);
    seedLegacyDatabase([
      { id: sharedId, filePath: original, rating: 5, views: 2, position: 7 },
    ]);
    const link = path.join(dir, 'media', 'library', 'movie.mp4');
    await fs.mkdir(path.dirname(link), { recursive: true });
    try {
      await fs.link(original, link);
    } catch {
      return; // Hard links unsupported on this filesystem.
    }
    initDatabase(dbPath);

    for (let i = 0; i < 2; i++) {
      await bulkUpsertMetadata(
        [{ filePath: link }, { filePath: original }],
        SCAN,
      );
      expect(rowFor(original)).toMatchObject({
        file_path_hash: sharedId,
        rating: 5,
        view_count: 2,
      });
      expect(rowFor(link)?.file_path_hash).not.toBe(sharedId);
    }
    expect(rows()).toHaveLength(2);
  });

  it('gives new copies found in the same scan separate rows', async () => {
    const a = await writeCopy('a/photo.jpg');
    const b = await writeCopy('b/photo.jpg');
    const fresh = new DatabaseSync(dbPath);
    initializeDatabase(fresh);
    fresh.close();
    initDatabase(dbPath);

    await bulkUpsertMetadata([{ filePath: a }, { filePath: b }], SCAN);

    const all = rows();
    expect(all.map((r) => r.file_path)).toEqual([a, b]);
    expect(new Set(all.map((r) => r.file_path_hash)).size).toBe(2);
  });
});
