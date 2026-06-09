import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initializeDatabase } from '../../src/core/database/database-schema';

describe('Database Schema vs Application Types', () => {
  let db: DatabaseSync;

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    initializeDatabase(db);
  });

  afterAll(() => {
    db.close();
  });

  it('verifies that aliasing columns produces camelCase properties matching application types', () => {
    const insertStmt = db.prepare(`
      INSERT INTO media_metadata (file_path_hash, file_path, duration, size, created_at, rating, extraction_status, in_library)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);

    insertStmt.run(
      'hash1',
      '/path/to/file.mp4',
      120,
      1024,
      '2023-01-01T00:00:00.000Z',
      5,
      'success',
    );
    db.prepare(
      `INSERT INTO media_segments (file_path_hash, type, start_time, end_time) VALUES (?, 'watched', ?, ?)`,
    ).run('hash1', 0, 10);

    // This query mirrors the aliasing used in database-worker.ts, including
    // the JSON reconstruction of watched segments.
    const row = db
      .prepare(
        `
      SELECT
        file_path as filePath,
        duration,
        size,
        created_at as createdAt,
        rating,
        extraction_status as status,
        NULLIF((SELECT json_group_array(json_object('start', s.start_time, 'end', s.end_time) ORDER BY s.start_time) FROM media_segments s WHERE s.file_path_hash = media_metadata.file_path_hash AND s.type = 'watched'), '[]') as watchedSegments
      FROM media_metadata WHERE file_path = ?
    `,
      )
      .get('/path/to/file.mp4') as any;

    expect(row).toHaveProperty('createdAt');
    expect(row).not.toHaveProperty('created_at');
    expect(row).toHaveProperty('status');
    expect(row).not.toHaveProperty('extraction_status');
    expect(row).toHaveProperty('filePath');
    expect(row).not.toHaveProperty('file_path');
    expect(row).toHaveProperty('watchedSegments');
    expect(row).not.toHaveProperty('watched_segments');
    expect(row.createdAt).toBe('2023-01-01T00:00:00.000Z');
    expect(row.status).toBe('success');
    // watchedSegments reconstructs the legacy JSON contract
    expect(JSON.parse(row.watchedSegments)).toEqual([{ start: 0, end: 10 }]);
  });
});
