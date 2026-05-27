import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  initializeSchema,
  migrateMediaMetadata,
} from '../../src/core/database-schema';

describe('Database Schema vs Application Types', () => {
  let db: DatabaseSync;

  beforeAll(() => {
    db = new DatabaseSync(':memory:');
    initializeSchema(db);
    migrateMediaMetadata(db);
  });

  afterAll(() => {
    db.close();
  });

  it('verifies that aliasing columns produces camelCase properties matching application types', () => {
    const insertStmt = db.prepare(`
      INSERT INTO media_metadata (file_path_hash, file_path, duration, size, created_at, rating, extraction_status, watched_segments)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertStmt.run(
      'hash1',
      '/path/to/file.mp4',
      120,
      1024,
      '2023-01-01T00:00:00.000Z',
      5,
      'success',
      null,
    );

    // This query simulates the fix we are applying in database-worker.ts
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
        watched_segments as watchedSegments
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
  });
});
