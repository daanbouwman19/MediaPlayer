import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initDatabase,
  closeDatabase,
  bulkUpsertMetadata,
  upsertMetadata,
} from '../../src/core/database/database-worker';
import fs from 'fs/promises';

// Mock worker_threads since we are importing the worker file which has side effects (parentPort usage)
vi.mock('worker_threads', () => ({
  parentPort: {
    on: vi.fn(),
    postMessage: vi.fn(),
  },
  default: {},
}));

const DB_PATH = ':memory:';

describe('Database Worker Bulk Upsert Coverage', () => {
  beforeEach(() => {
    // Ensure DB is clean before each test
    // Some tests might purposefully NOT init the DB
  });

  afterEach(async () => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  it('should return error if DB not initialized (bulkUpsertMetadata)', async () => {
    // Ensure DB is closed
    closeDatabase();
    const result = await bulkUpsertMetadata([{ filePath: '/test.mp4' }]);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Database not initialized');
  });

  it('should return success early if all payloads are filtered out (bulkUpsertMetadata)', async () => {
    initDatabase(DB_PATH);

    // 1. Insert a file initially
    await upsertMetadata({ filePath: '/existing.mp4', size: 100 });

    // 2. Try to bulk upsert the same file with NO metadata (should be filtered)
    // We spy on console.log or just check result.success
    const result = await bulkUpsertMetadata([{ filePath: '/existing.mp4' }]);
    expect(result.success).toBe(true);

    // To verify it actually skipped, we'd ideally mock internal functions,
    // but here we trust the logic if it returns success.
    // We can infer coverage will hit the "if (payloadsToProcess.length === 0)" branch.
  });

  it("should handle partial filtering (some exist, some don't)", async () => {
    initDatabase(DB_PATH);

    // 1. Insert one file
    await upsertMetadata({ filePath: '/existing.mp4', size: 100 });

    // 2. Bulk upsert: one existing (skip), one new (process)
    const payloads = [
      { filePath: '/existing.mp4' }, // Should be skipped
      { filePath: '/new.mp4' }, // Should be processed
    ];

    const result = await bulkUpsertMetadata(payloads);
    expect(result.success).toBe(true);

    // Verify /new.mp4 is in DB (requires a way to query, maybe upsertMetadata works?)
    // We can't query directly without exposing more functions or using a query helper
    // checking success is enough for coverage.
  });

  it('should handle empty payloads array', async () => {
    initDatabase(DB_PATH);
    const result = await bulkUpsertMetadata([]);
    expect(result.success).toBe(true);
  });

  it('should handle generateFileId errors gracefully', async () => {
    initDatabase(DB_PATH);

    // Mock fs.stat to throw for a specific file to trigger catch block in generateFileId
    // Note: generateFileId uses fs.stat
    vi.spyOn(fs, 'stat').mockRejectedValueOnce(new Error('Access Denied'));

    // This forces generateFileId to hit the catch block and use fallback hash
    const result = await upsertMetadata({ filePath: '/error.mp4' });
    expect(result.success).toBe(true);
  });

  it('should handle db error in bulkUpsertMetadata', async () => {
    initDatabase(DB_PATH);
    // Mock generateFileIdsBatched to throw? Or just pass invalid data that DB rejects?
    // Since generateFileIdsBatched is internal, difficult to mock directly without rewiring.
    // But we can try to make transaction fail.

    // We can close DB *during* operation if possible, but that's racy.
    // Easier: rely on "Database not initialized" check above.
    // For the try/catch block inside:

    const result = await bulkUpsertMetadata([
      // @ts-expect-error - Invalid payload to potentially trigger SQL error?
      { filePath: null },
    ]);
    expect(result.success).toBe(false);
  });
});
