import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import {
  initializeSchema,
  createIndexes,
  migrateMediaDirectories,
  migrateMediaMetadata,
} from '../../src/core/database-schema';

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

  describe('Initialization', () => {
    it('initializes all tables', () => {
      initializeSchema(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[];
      const tableNames = tables.map((t) => t.name);
      expect(tableNames).toContain('media_views');
      expect(tableNames).toContain('app_cache');
      expect(tableNames).toContain('media_directories');
      expect(tableNames).toContain('media_metadata');
      expect(tableNames).toContain('smart_playlists');
      expect(tableNames).toContain('settings');
    });
  });

  describe('Indexes', () => {
    it('creates indexes correctly', () => {
      initializeSchema(db);
      createIndexes(db);
      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[];
      const indexNames = indexes.map((i) => i.name);
      expect(indexNames).toContain('idx_media_metadata_status');
      expect(indexNames).toContain('idx_media_metadata_file_path');
      expect(indexNames).toContain('idx_media_views_last_viewed');
    });

    it('handles index creation failure gracefully', () => {
      initializeSchema(db);
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Mock db.prepare to throw for index creation
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

  describe('Migrations', () => {
    describe('media_directories', () => {
      it('migrates from old schema (no id) to new schema', () => {
        // Create old schema
        db.exec(
          'CREATE TABLE media_directories (path TEXT UNIQUE, is_active INTEGER DEFAULT 1)',
        );
        db.prepare(
          'INSERT INTO media_directories (path, is_active) VALUES (?, ?)',
        ).run('/old/path', 1);

        migrateMediaDirectories(db);

        // Verify new schema
        const columns = db
          .prepare("PRAGMA table_info('media_directories')")
          .all() as { name: string }[];
        const columnNames = columns.map((c) => c.name);
        expect(columnNames).toContain('id');
        expect(columnNames).toContain('type');
        expect(columnNames).toContain('name');

        // Verify data
        const row = db
          .prepare('SELECT * FROM media_directories WHERE path = ?')
          .get('/old/path') as any;
        expect(row).toBeDefined();
        expect(row.id).toBeDefined();
        expect(row.type).toBe('local');
        expect(row.name).toBe('path'); // basename of /old/path
      });

      it('skips migration if table does not exist', () => {
        // Do nothing (table doesn't exist)
        migrateMediaDirectories(db);
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='media_directories'",
          )
          .all();
        expect(tables).toHaveLength(0);
      });

      it('skips migration if already migrated', () => {
        initializeSchema(db); // Creates new schema
        const spy = vi.spyOn(console, 'log');
        migrateMediaDirectories(db);
        expect(spy).not.toHaveBeenCalledWith(
          expect.stringContaining('Migrating media_directories table'),
        );
      });
    });

    describe('media_metadata', () => {
      it('adds missing columns', () => {
        // Create table with missing columns
        db.exec(
          'CREATE TABLE media_metadata (file_path_hash TEXT PRIMARY KEY)',
        );

        migrateMediaMetadata(db);

        const columns = db
          .prepare("PRAGMA table_info('media_metadata')")
          .all() as { name: string }[];
        const columnNames = columns.map((c) => c.name);
        expect(columnNames).toContain('file_path');
        expect(columnNames).toContain('size');
        expect(columnNames).toContain('rating');
        expect(columnNames).toContain('watched_segments');
      });

      it('handles migration errors gracefully', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        // Mock prepare to throw
        vi.spyOn(db, 'prepare').mockImplementation(() => {
          throw new Error('Migration Error');
        });

        migrateMediaMetadata(db);
        expect(spy).toHaveBeenCalledWith(
          expect.stringContaining('Error migrating media_metadata table'),
          expect.any(Error),
        );
      });
    });
  });
});
