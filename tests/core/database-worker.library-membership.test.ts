/**
 * Library membership (media_metadata.in_library) against a real SQLite
 * database: only scans grant it, scans and source removal revoke it.
 * Membership alone authorizes Drive files (security.ts isFileInLibrary).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

vi.mock('worker_threads');

import {
  initDatabase,
  closeDatabase,
  upsertMetadata,
  bulkUpsertMetadata,
  getMetadata,
  cacheAlbums,
  getCachedAlbums,
  recordMediaView,
  getMediaViewCounts,
  addMediaDirectory,
  getMediaDirectories,
  removeMediaDirectory,
  setDirectoryActiveState,
  canonicalizeMediaDirectory,
  executeSmartPlaylist,
  addJob,
  getPendingJobs,
  updateWatchedSegments,
} from '../../src/core/database/database-worker';
import type { Album } from '../../src/core/media/types';
import { MAX_WATCHED_SEGMENTS } from '../../src/core/database/metadata-validation';

const CACHE_KEY = 'file_index_json';

const album = (id: string, paths: string[], children: Album[] = []): Album => ({
  id,
  name: id,
  textures: paths.map((p) => ({ name: path.basename(p), path: p })),
  children,
});

const isMember = async (filePath: string): Promise<boolean> => {
  const result = await getMetadata([filePath]);
  expect(result.success).toBe(true);
  return (result.data as Record<string, unknown>)[filePath] !== undefined;
};

const scan = async (albums: Album[]) => {
  const result = await cacheAlbums(CACHE_KEY, albums);
  expect(result).toEqual({ success: true });
};

// Local roots do not need to exist; file IDs fall back to path hashes.
const LIB = path.resolve('/p08-lib');
const OTHER = path.resolve('/p08-other');

describe('database worker: library membership', () => {
  beforeEach(() => {
    expect(initDatabase(':memory:').success).toBe(true);
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  describe('granting membership', () => {
    it('never lets a client upsert make a file a library member (F13)', async () => {
      await upsertMetadata({ filePath: 'gdrive://foreign-file', rating: 5 });

      expect(await isMember('gdrive://foreign-file')).toBe(false);
      const playlist = executeSmartPlaylist('{}');
      expect(playlist.data).toEqual([]);
    });

    it('keeps the membership of a library file a client upserts', async () => {
      addMediaDirectory({ path: LIB });
      const file = path.join(LIB, 'a.mp4');
      await scan([album(LIB, [file])]);

      await upsertMetadata({ filePath: file, rating: 4 });

      const result = await getMetadata([file]);
      expect((result.data as Record<string, { rating: number }>)[file]).toEqual(
        expect.objectContaining({ rating: 4 }),
      );
    });

    it('does not grant membership through metadata extraction upserts', async () => {
      const file = path.join(LIB, 'extracted.mp4');
      await bulkUpsertMetadata([{ filePath: file, status: 'success' }]);
      expect(await isMember(file)).toBe(false);
    });

    it('promotes rows that exist without membership on the next scan (F91)', async () => {
      addMediaDirectory({ path: 'gdrive://folder', type: 'google_drive' });
      // A stats-only row, as recordMediaView creates for unindexed files.
      await recordMediaView('gdrive://viewed-first');
      expect(await isMember('gdrive://viewed-first')).toBe(false);

      await scan([album('folder', ['gdrive://viewed-first'])]);

      expect(await isMember('gdrive://viewed-first')).toBe(true);
      const counts = await getMediaViewCounts(['gdrive://viewed-first']);
      expect(counts.data).toEqual({ 'gdrive://viewed-first': 1 });
    });
  });

  describe('revoking membership on scans (F68)', () => {
    it('demotes members a scan no longer finds', async () => {
      addMediaDirectory({ path: LIB });
      const kept = path.join(LIB, 'kept.mp4');
      const gone = path.join(LIB, 'gone.mp4');
      await scan([album(LIB, [kept, gone])]);
      expect(await isMember(gone)).toBe(true);

      await scan([album(LIB, [kept])]);

      expect(await isMember(kept)).toBe(true);
      expect(await isMember(gone)).toBe(false);
    });

    it('keeps the previous files of an active source the scan could not read', async () => {
      addMediaDirectory({ path: 'gdrive://folderA', type: 'google_drive' });
      addMediaDirectory({ path: LIB });
      const local = path.join(LIB, 'a.mp4');
      await scan([
        album('folderA', ['gdrive://drive-1'], [album('sub', ['gdrive://d2'])]),
        album(LIB, [local]),
      ]);

      // The Drive root failed transiently: the scanner returned no album.
      await scan([album(LIB, [local])]);
      expect(await isMember('gdrive://drive-1')).toBe(true);
      expect(await isMember('gdrive://d2')).toBe(true);

      // The next scan reaches the folder again; d2 was deleted meanwhile.
      await scan([album('folderA', ['gdrive://drive-1']), album(LIB, [local])]);
      expect(await isMember('gdrive://drive-1')).toBe(true);
      expect(await isMember('gdrive://d2')).toBe(false);
    });

    it('demotes members that no active source provides', async () => {
      // E.g. rows from before membership was reconciled.
      await bulkUpsertMetadata([{ filePath: 'gdrive://x' }], {
        markInLibrary: true,
      });
      expect(await isMember('gdrive://x')).toBe(true);

      await scan([]);

      expect(await isMember('gdrive://x')).toBe(false);
    });

    it('ignores a scanned source that is no longer active', async () => {
      addMediaDirectory({ path: 'gdrive://A', type: 'google_drive' });
      addMediaDirectory({ path: 'gdrive://B', type: 'google_drive' });
      await scan([album('A', ['gdrive://a1']), album('B', ['gdrive://b1'])]);

      // A scan that started before A was removed finishes afterwards.
      removeMediaDirectory('gdrive://A');
      await scan([
        album('A', ['gdrive://a1', 'gdrive://a2']),
        album('B', ['gdrive://b1']),
      ]);

      expect(await isMember('gdrive://a1')).toBe(false);
      expect(await isMember('gdrive://a2')).toBe(false);
      expect(await isMember('gdrive://b1')).toBe(true);
      const cached = getCachedAlbums(CACHE_KEY).data as Album[];
      expect(cached.map((a) => a.id)).toEqual(['B']);
    });

    it('ignores a source deactivated while the scan result is being stored', async () => {
      addMediaDirectory({ path: 'gdrive://A', type: 'google_drive' });
      addMediaDirectory({ path: LIB });
      const local = path.join(LIB, 'a.mp4');

      const pending = cacheAlbums(CACHE_KEY, [
        album('A', ['gdrive://a1']),
        album(LIB, [local]),
      ]);
      // Runs while cacheAlbums prepares the file IDs.
      setDirectoryActiveState('gdrive://A', false);

      expect(await pending).toEqual({ success: true });
      expect(await isMember('gdrive://a1')).toBe(false);
      expect(await isMember(local)).toBe(true);
      expect(getCachedAlbums(CACHE_KEY).data).toEqual([album(LIB, [local])]);
    });
  });

  describe('revoking membership when a source goes away (F68)', () => {
    it('demotes the files of a removed Drive source, except shared ones', async () => {
      addMediaDirectory({ path: 'gdrive://A', type: 'google_drive' });
      addMediaDirectory({ path: 'gdrive://B', type: 'google_drive' });
      await scan([
        album('A', ['gdrive://only-a', 'gdrive://shared']),
        album('B', ['gdrive://shared', 'gdrive://only-b']),
      ]);

      expect(removeMediaDirectory('gdrive://A')).toEqual({ success: true });

      expect(await isMember('gdrive://only-a')).toBe(false);
      expect(await isMember('gdrive://shared')).toBe(true);
      expect(await isMember('gdrive://only-b')).toBe(true);
      const dirs = getMediaDirectories().data as { path: string }[];
      expect(dirs.map((d) => d.path)).toEqual(['gdrive://B']);
    });

    it('demotes files under a removed local source, also ones the cache no longer lists', async () => {
      const nested = path.join(LIB, 'nested');
      addMediaDirectory({ path: LIB });
      addMediaDirectory({ path: nested });
      addMediaDirectory({ path: OTHER });
      const inCache = path.join(LIB, 'a.mp4');
      const nestedFile = path.join(nested, 'n.mp4');
      const otherFile = path.join(OTHER, 'o.mp4');
      await scan([
        album(LIB, [inCache]),
        album(nested, [nestedFile]),
        album(OTHER, [otherFile]),
      ]);
      // A member the cached tree does not list (e.g. from before the cache).
      const legacy = path.join(LIB, 'old', 'legacy.mp4');
      await bulkUpsertMetadata([{ filePath: legacy }], { markInLibrary: true });
      expect(await isMember(legacy)).toBe(true);

      removeMediaDirectory(LIB);

      expect(await isMember(inCache)).toBe(false);
      expect(await isMember(legacy)).toBe(false);
      // Still provided by the nested source and by an unrelated one.
      expect(await isMember(nestedFile)).toBe(true);
      expect(await isMember(otherFile)).toBe(true);
    });

    it('demotes on deactivation and restores on re-activation', async () => {
      addMediaDirectory({ path: 'gdrive://A', type: 'google_drive' });
      await scan([album('A', ['gdrive://a1'])]);

      setDirectoryActiveState('gdrive://A', false);
      expect(await isMember('gdrive://a1')).toBe(false);

      setDirectoryActiveState('gdrive://A', true);
      expect(await isMember('gdrive://a1')).toBe(true);
    });
  });

  describe('canonicalizeMediaDirectory (F83)', () => {
    const LEGACY = path.resolve('/p08-legacy-link');
    const CANONICAL = path.resolve('/p08-real', 'media');

    it('moves the source row and the stored paths of its files', async () => {
      addMediaDirectory({ id: 'dir-1', path: LEGACY });
      const legacyFile = path.join(LEGACY, 'sub', 'clip.mp4');
      await scan([
        album(LEGACY, [], [album(path.join(LEGACY, 'sub'), [legacyFile])]),
      ]);
      await updateWatchedSegments(
        legacyFile,
        JSON.stringify([{ start: 1, end: 2 }]),
      );
      await addJob('transcode', legacyFile);

      expect(canonicalizeMediaDirectory(LEGACY, CANONICAL)).toEqual({
        success: true,
      });

      const dirs = getMediaDirectories().data as {
        id: string;
        path: string;
        isActive: boolean;
      }[];
      expect(dirs).toEqual([
        expect.objectContaining({
          id: 'dir-1',
          path: CANONICAL,
          isActive: true,
        }),
      ]);
      const movedFile = path.join(CANONICAL, 'sub', 'clip.mp4');
      const meta = (await getMetadata([movedFile])).data as Record<
        string,
        { watchedSegments: string }
      >;
      expect(JSON.parse(meta[movedFile].watchedSegments)).toEqual([
        { start: 1, end: 2 },
      ]);
      expect(getPendingJobs('transcode').data).toEqual([movedFile]);
      // The cached tree still holds legacy paths; the next load rescans.
      expect(getCachedAlbums(CACHE_KEY).data).toBeNull();
    });

    it('still completes when a row already exists at a canonical file path', async () => {
      addMediaDirectory({ id: 'dir-1', path: LEGACY });
      const legacyClash = path.join(LEGACY, 'x.mp4');
      const legacyOther = path.join(LEGACY, 'y.mp4');
      // A leftover row at the canonical path (e.g. from a removed source).
      // media_metadata.file_path is not UNIQUE, so the rewrite cannot
      // conflict with it and roll the canonicalisation back.
      await upsertMetadata({
        filePath: path.join(CANONICAL, 'x.mp4'),
        rating: 2,
      });
      await scan([album(LEGACY, [legacyClash, legacyOther])]);
      await upsertMetadata({ filePath: legacyOther, rating: 5 });

      expect(canonicalizeMediaDirectory(LEGACY, CANONICAL)).toEqual({
        success: true,
      });

      const dirs = getMediaDirectories().data as {
        id: string;
        path: string;
      }[];
      expect(dirs).toEqual([
        expect.objectContaining({ id: 'dir-1', path: CANONICAL }),
      ]);
      const movedOther = path.join(CANONICAL, 'y.mp4');
      const meta = (await getMetadata([movedOther, legacyOther, legacyClash]))
        .data as Record<string, { rating: number }>;
      expect(meta[movedOther]?.rating).toBe(5);
      expect(meta[legacyOther]).toBeUndefined();
      expect(meta[legacyClash]).toBeUndefined();
    });

    it('leaves an inactive alias and the album cache alone on later starts', async () => {
      addMediaDirectory({ path: LEGACY });
      addMediaDirectory({ path: CANONICAL });
      expect(canonicalizeMediaDirectory(LEGACY, CANONICAL)).toEqual({
        success: true,
      });
      const file = path.join(CANONICAL, 'a.mp4');
      await scan([album(CANONICAL, [file])]);

      // The next start sends the same request again.
      expect(canonicalizeMediaDirectory(LEGACY, CANONICAL)).toEqual({
        success: true,
      });
      // As do a legacy row removed meanwhile and a row that is canonical.
      canonicalizeMediaDirectory(path.resolve('/p08-removed'), CANONICAL);
      canonicalizeMediaDirectory(CANONICAL, CANONICAL);

      expect(getCachedAlbums(CACHE_KEY).data).toEqual([
        album(CANONICAL, [file]),
      ]);
      expect(await isMember(file)).toBe(true);
      const dirs = getMediaDirectories().data as {
        path: string;
        isActive: boolean;
      }[];
      expect(dirs).toEqual([
        expect.objectContaining({ path: LEGACY, isActive: false }),
        expect.objectContaining({ path: CANONICAL, isActive: true }),
      ]);
    });

    it('only deactivates a legacy alias of a source that already exists', async () => {
      addMediaDirectory({ path: LEGACY });
      addMediaDirectory({ path: CANONICAL });

      canonicalizeMediaDirectory(LEGACY, CANONICAL);

      const dirs = getMediaDirectories().data as {
        path: string;
        isActive: boolean;
      }[];
      expect(dirs).toHaveLength(2);
      expect(dirs.find((d) => d.path === LEGACY)?.isActive).toBe(false);
      expect(dirs.find((d) => d.path === CANONICAL)?.isActive).toBe(true);
    });
  });

  it('caps the number of watched segments stored per file', async () => {
    const tooMany = Array.from(
      { length: MAX_WATCHED_SEGMENTS + 1 },
      (_, i) => ({
        start: i,
        end: i + 0.5,
      }),
    );
    const result = await updateWatchedSegments(
      'gdrive://file',
      JSON.stringify(tooMany),
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Too many watched segments/);
  });
});

describe('database worker: file-backed database', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p08-db-'));
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('sets a busy timeout so concurrent writers wait instead of failing', () => {
    const execSpy = vi.spyOn(DatabaseSync.prototype, 'exec');
    expect(initDatabase(path.join(tempDir, 'busy.sqlite')).success).toBe(true);
    expect(execSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^PRAGMA busy_timeout = [1-9]\d*$/),
    );
  });

  it('rolls back library membership when the album cache cannot be written (F92)', async () => {
    const dbPath = path.join(tempDir, 'library.sqlite');
    expect(initDatabase(dbPath).success).toBe(true);
    addMediaDirectory({ path: 'gdrive://folder', type: 'google_drive' });
    const other = new DatabaseSync(dbPath);
    other.exec(
      `CREATE TRIGGER fail_cache BEFORE INSERT ON app_cache BEGIN SELECT RAISE(ABORT, 'disk full'); END`,
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const result = await cacheAlbums(CACHE_KEY, [
        album('folder', ['gdrive://new']),
      ]);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disk full/);
      expect(errorSpy).toHaveBeenCalled();
      // Nothing half-applied: the file is neither listed nor authorized.
      expect(await isMember('gdrive://new')).toBe(false);
      expect(getCachedAlbums(CACHE_KEY).data).toBeNull();

      other.exec('DROP TRIGGER fail_cache');
      expect(
        await cacheAlbums(CACHE_KEY, [album('folder', ['gdrive://new'])]),
      ).toEqual({ success: true });
      expect(await isMember('gdrive://new')).toBe(true);
    } finally {
      other.close();
    }
  });

  it('closes the connection when opening the database fails (F88)', async () => {
    const dbPath = path.join(tempDir, 'corrupt.sqlite');
    fs.writeFileSync(dbPath, 'this is not a sqlite database '.repeat(200));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = initDatabase(dbPath);

    expect(result.success).toBe(false);
    // An open handle would keep the file locked (on Windows it could not be
    // replaced by a backup or a fresh database).
    expect(() => fs.renameSync(dbPath, `${dbPath}.bak`)).not.toThrow();
    expect((await getMetadata(['x'])).error).toBe('Database not initialized');
    // Recovery still works afterwards.
    expect(initDatabase(path.join(tempDir, 'fresh.sqlite')).success).toBe(true);
  });
});
