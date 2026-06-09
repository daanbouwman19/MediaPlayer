import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import {
  initializeDatabase,
  createIndexes,
  getUserVersion,
  LATEST_DB_VERSION,
} from '../../src/core/database/database-schema';

/** Builds a database in the legacy (pre-versioning) shape with sample data. */
function createLegacyDatabase(db: DatabaseSync): void {
  db.exec(`CREATE TABLE media_views (
    file_path_hash TEXT PRIMARY KEY,
    file_path TEXT UNIQUE,
    view_count INTEGER DEFAULT 0,
    last_viewed TEXT
  )`);
  db.exec(`CREATE TABLE media_metadata (
    file_path_hash TEXT PRIMARY KEY,
    file_path TEXT,
    duration REAL,
    size INTEGER,
    created_at TEXT,
    rating INTEGER DEFAULT 0,
    extraction_status TEXT DEFAULT 'pending',
    watched_segments TEXT,
    playback_position REAL DEFAULT 0
  )`);
  db.exec(
    `CREATE TABLE media_directories (path TEXT UNIQUE, is_active INTEGER DEFAULT 1)`,
  );
  db.exec(`CREATE TABLE transcode_jobs (
    file_path TEXT PRIMARY KEY,
    file_path_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
}

describe('Database Schema', () => {
  let db: DatabaseSync;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(
      path.join(process.cwd(), 'tests', 'temp', 'schema-'),
    );
    dbPath = path.join(tempDir, 'test.db');
    db = new DatabaseSync(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const getTableNames = () =>
    (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((t) => t.name);

  const getColumnNames = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
      (c) => c.name,
    );

  describe('Fresh database', () => {
    it('creates the latest schema and sets user_version', () => {
      initializeDatabase(db);

      const tables = getTableNames();
      expect(tables).toContain('media_metadata');
      expect(tables).toContain('media_segments');
      expect(tables).toContain('jobs');
      expect(tables).toContain('app_cache');
      expect(tables).toContain('media_directories');
      expect(tables).toContain('smart_playlists');
      expect(tables).toContain('settings');
      // Legacy tables are gone
      expect(tables).not.toContain('media_views');
      expect(tables).not.toContain('transcode_jobs');

      expect(getUserVersion(db)).toBe(LATEST_DB_VERSION);
    });

    it('media_metadata has merged view columns and no watched_segments', () => {
      initializeDatabase(db);
      const columns = getColumnNames('media_metadata');
      expect(columns).toContain('view_count');
      expect(columns).toContain('last_viewed');
      expect(columns).toContain('in_library');
      expect(columns).not.toContain('watched_segments');
    });

    it('is idempotent (re-running performs no further migrations)', () => {
      initializeDatabase(db);
      const logSpy = vi.spyOn(console, 'log');
      initializeDatabase(db);
      expect(logSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('migrated to version'),
      );
      expect(getUserVersion(db)).toBe(LATEST_DB_VERSION);
    });
  });

  describe('Legacy database upgrade', () => {
    it('merges media_views into media_metadata', () => {
      createLegacyDatabase(db);
      db.prepare(
        `INSERT INTO media_metadata (file_path_hash, file_path, duration) VALUES (?, ?, ?)`,
      ).run('hash1', '/lib/movie.mp4', 120);
      db.prepare(
        `INSERT INTO media_views (file_path_hash, file_path, view_count, last_viewed) VALUES (?, ?, ?, ?)`,
      ).run('hash1', '/lib/movie.mp4', 7, '2026-01-01T00:00:00.000Z');
      // Ghost: viewed but never indexed
      db.prepare(
        `INSERT INTO media_views (file_path_hash, file_path, view_count, last_viewed) VALUES (?, ?, ?, ?)`,
      ).run('ghost1', '/gone/ghost.mp4', 3, '2026-02-01T00:00:00.000Z');

      initializeDatabase(db);

      const library = db
        .prepare(`SELECT * FROM media_metadata WHERE file_path_hash = 'hash1'`)
        .get() as any;
      expect(library.view_count).toBe(7);
      expect(library.last_viewed).toBe('2026-01-01T00:00:00.000Z');
      expect(library.in_library).toBe(1);
      expect(library.duration).toBe(120);

      const ghost = db
        .prepare(`SELECT * FROM media_metadata WHERE file_path_hash = 'ghost1'`)
        .get() as any;
      expect(ghost.view_count).toBe(3);
      expect(ghost.file_path).toBe('/gone/ghost.mp4');
      expect(ghost.in_library).toBe(0);
    });

    it('converts watched_segments JSON into media_segments rows', () => {
      createLegacyDatabase(db);
      db.prepare(
        `INSERT INTO media_metadata (file_path_hash, file_path, watched_segments) VALUES (?, ?, ?)`,
      ).run(
        'hash1',
        '/lib/movie.mp4',
        JSON.stringify([
          { start: 10, end: 20 },
          { start: 0, end: 5 },
        ]),
      );
      // Corrupt JSON is skipped without aborting the migration
      db.prepare(
        `INSERT INTO media_metadata (file_path_hash, file_path, watched_segments) VALUES (?, ?, ?)`,
      ).run('hash2', '/lib/corrupt.mp4', '{not json');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      initializeDatabase(db);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping invalid watched_segments JSON'),
      );

      const segments = db
        .prepare(
          `SELECT * FROM media_segments WHERE file_path_hash = 'hash1' ORDER BY start_time`,
        )
        .all() as any[];
      expect(segments).toHaveLength(2);
      expect(segments[0].start_time).toBe(0);
      expect(segments[0].end_time).toBe(5);
      expect(segments[0].type).toBe('watched');
      expect(segments[1].start_time).toBe(10);

      const corruptSegments = db
        .prepare(`SELECT * FROM media_segments WHERE file_path_hash = 'hash2'`)
        .all();
      expect(corruptSegments).toHaveLength(0);
    });

    it('moves transcode_jobs into the typed jobs table', () => {
      createLegacyDatabase(db);
      db.prepare(
        `INSERT INTO transcode_jobs (file_path, file_path_hash, status, error) VALUES (?, ?, ?, ?)`,
      ).run('/lib/movie.mp4', 'hash1', 'failed', 'boom');

      initializeDatabase(db);

      const jobs = db.prepare(`SELECT * FROM jobs`).all() as any[];
      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('transcode');
      expect(jobs[0].file_path).toBe('/lib/movie.mp4');
      expect(jobs[0].status).toBe('failed');
      expect(jobs[0].error).toBe('boom');
      expect(getTableNames()).not.toContain('transcode_jobs');
    });

    it('rebuilds old media_directories (no id column)', () => {
      createLegacyDatabase(db);
      db.prepare(
        'INSERT INTO media_directories (path, is_active) VALUES (?, ?)',
      ).run('/old/path', 1);

      initializeDatabase(db);

      const columns = getColumnNames('media_directories');
      expect(columns).toContain('id');
      expect(columns).toContain('type');
      expect(columns).toContain('name');

      const row = db
        .prepare('SELECT * FROM media_directories WHERE path = ?')
        .get('/old/path') as any;
      expect(row.id).toBeDefined();
      expect(row.type).toBe('local');
      expect(row.name).toBe('path');
    });

    it('adds columns missing from very old media_metadata tables', () => {
      db.exec('CREATE TABLE media_metadata (file_path_hash TEXT PRIMARY KEY)');

      initializeDatabase(db);

      const columns = getColumnNames('media_metadata');
      expect(columns).toContain('file_path');
      expect(columns).toContain('size');
      expect(columns).toContain('rating');
      expect(columns).toContain('playback_position');
      expect(columns).toContain('view_count');
    });
  });

  describe('Migration safety', () => {
    it('rolls back a failed migration and keeps the previous version', () => {
      // Set up a v2-shaped database where the v3 migration will fail because
      // media_segments already exists.
      createLegacyDatabase(db);
      db.exec(
        `ALTER TABLE media_metadata ADD COLUMN view_count INTEGER DEFAULT 0`,
      );
      db.exec(`ALTER TABLE media_metadata ADD COLUMN last_viewed TEXT`);
      db.exec(
        `ALTER TABLE media_metadata ADD COLUMN in_library INTEGER DEFAULT 0`,
      );
      db.exec('DROP TABLE media_views');
      db.exec('CREATE TABLE media_segments (id INTEGER PRIMARY KEY)');
      db.exec('PRAGMA user_version = 2');

      expect(() => initializeDatabase(db)).toThrow();
      expect(getUserVersion(db)).toBe(2);
    });

    it('skips migrations when the database is from a newer app version', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      db.exec(`PRAGMA user_version = ${LATEST_DB_VERSION + 1}`);

      initializeDatabase(db);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('newer than supported version'),
      );
      expect(getUserVersion(db)).toBe(LATEST_DB_VERSION + 1);
    });
  });

  describe('Indexes', () => {
    it('creates indexes for the latest schema', () => {
      initializeDatabase(db);
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_media_metadata_status');
      expect(indexNames).toContain('idx_media_metadata_file_path');
      expect(indexNames).toContain('idx_media_metadata_last_viewed');
      expect(indexNames).toContain('idx_media_segments_file');
      expect(indexNames).toContain('idx_jobs_status');
    });

    it('handles index creation failure gracefully', () => {
      initializeDatabase(db);
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const originalPrepare = db.prepare.bind(db);
      vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (sql.includes('CREATE INDEX')) {
          throw new Error('Index Error');
        }
        return originalPrepare(sql);
      });

      createIndexes(db);
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create index'),
        expect.any(Error),
      );
    });
  });
});
