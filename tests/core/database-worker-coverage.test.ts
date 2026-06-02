// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Define the mock instance hoisted
const {
  mockDbInstance,
  mockStatement,
  mockMessageHandlerRef,
  mockPostMessageSpy,
} = vi.hoisted(() => {
  const stmt = {
    run: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    get: vi.fn(),
  };

  const instance = {
    exec: vi.fn(),
    prepare: vi.fn().mockReturnValue(stmt),
    close: vi.fn(),
  };

  const handlerRef = { handler: null as any };
  const spy = vi.fn();

  return {
    mockDbInstance: instance,
    mockStatement: stmt,
    mockMessageHandlerRef: handlerRef,
    mockPostMessageSpy: spy,
  };
});

// Mock dependencies
vi.mock('worker_threads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('worker_threads')>();
  const mock = {
    ...actual,
    parentPort: {
      on: vi.fn((event, handler) => {
        if (event === 'message') {
          mockMessageHandlerRef.handler = handler;
        }
      }),
      postMessage: mockPostMessageSpy,
    },
    isMainThread: false,
  };
  return {
    ...mock,
    default: mock,
  };
});

vi.mock('node:sqlite', () => {
  return {
    DatabaseSync: vi.fn(function () {
      return mockDbInstance;
    }),
  };
});

vi.mock('../../src/core/database/database-schema', () => ({
  initializeSchema: vi.fn(),
  migrateMediaDirectories: vi.fn(),
  migrateMediaMetadata: vi.fn(),
  createIndexes: vi.fn(),
}));

vi.mock('../../src/core/media/media-utils', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media/media-utils')>();
  return {
    ...actual,
    isDrivePath: vi.fn((p) => p && p.startsWith('gdrive://')),
    getDriveId: vi.fn((p) => p.split('gdrive://')[1]),
  };
});

vi.mock('fs/promises', async () => {
  return {
    default: {
      stat: vi.fn((path) => {
        if (path === '/error/path') {
          throw new Error('Unknown error');
        }
        if (path === '/enoent/path') {
          const e: any = new Error('ENOENT');
          e.code = 'ENOENT';
          throw e;
        }
        return Promise.resolve({
          size: 100,
          mtime: new Date(),
        });
      }),
    },
  };
});

import * as worker from '../../src/core/database/database-worker';
import { DatabaseSync } from 'node:sqlite';

describe('Database Worker Coverage', () => {
  let mockGetFileIdsStmt: any;
  let mockGetMetadataStmt: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPostMessageSpy.mockClear();

    // Reset the statement mock to default state
    mockStatement.run.mockReset();
    mockStatement.all.mockReset();
    mockStatement.get.mockReset();
    mockStatement.all.mockReturnValue([]);

    // Initialize specific mocks
    mockGetFileIdsStmt = { all: vi.fn().mockReturnValue([]) };
    mockGetMetadataStmt = { all: vi.fn().mockReturnValue([]) };

    // Smart prepare mock
    mockDbInstance.prepare.mockImplementation((sql: string) => {
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT file_path, file_path_hash FROM media_metadata')
      ) {
        return mockGetFileIdsStmt;
      }
      // Covers getMetadataBatch
      if (
        typeof sql === 'string' &&
        sql.includes('SELECT') &&
        sql.includes('file_path as filePath') &&
        sql.includes('FROM media_metadata')
      ) {
        return mockGetMetadataStmt;
      }
      return mockStatement;
    });

    // Re-initialize DB
    const res = worker.initDatabase(':memory:');
    if (!res.success) {
      throw new Error('Failed to init DB in beforeEach');
    }
  });

  afterEach(() => {
    worker.closeDatabase();
  });

  it('initDatabase - handles initialization failure', () => {
    // Force constructor to throw
    (DatabaseSync as any).mockImplementationOnce(function () {
      throw new Error('Init failed');
    });
    const result = worker.initDatabase(':memory:');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Init failed');
  });

  it('upsertMetadata - handles error', async () => {
    // We affect the cached statement
    mockStatement.run.mockImplementationOnce(() => {
      throw new Error('Insert failed');
    });

    const result = await worker.upsertMetadata({ filePath: '/test.mp4' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Insert failed');
  });

  it('upsertMetadata - handles drive path', async () => {
    // Should generate ID from drive ID
    const result = await worker.upsertMetadata({ filePath: 'gdrive://fileid' });
    expect(result.success).toBe(true);
    expect(mockStatement.run).toHaveBeenCalled();
  });

  it('upsertMetadata - handles fs.stat error (non-ENOENT)', async () => {
    // Should log error and fallback to hashing path
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await worker.upsertMetadata({ filePath: '/error/path' });
    expect(result.success).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('setRating - handles error', async () => {
    mockStatement.run.mockImplementationOnce(() => {
      throw new Error('Update failed');
    });

    const result = await worker.setRating('/test.mp4', 5);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Update failed');
  });

  it('updateWatchedSegments - handles error', async () => {
    mockStatement.run.mockImplementationOnce(() => {
      throw new Error('Update failed');
    });

    const result = await worker.updateWatchedSegments('/test.mp4', '[]');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Update failed');
  });

  it('getAllMetadata - handles error', () => {
    mockGetMetadataStmt.all.mockImplementationOnce(() => {
      throw new Error('Query failed');
    });

    const result = worker.getAllMetadata();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Query failed');
  });

  it('filterProcessingNeeded - handles error', async () => {
    mockStatement.all.mockImplementationOnce(() => {
      throw new Error('Query failed');
    });

    const result = await worker.filterProcessingNeeded(['/test.mp4']);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Query failed');
  });

  it('filterProcessingNeeded - returns empty for empty input', async () => {
    const result = await worker.filterProcessingNeeded([]);
    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  it('filterProcessingNeeded - handles large batch (simulated)', async () => {
    // Create array > 900 items
    const paths = Array.from({ length: 950 }, (_, i) => `/file${i}.mp4`);

    // Mock all to return nothing (all needed)
    mockStatement.all.mockReturnValue([]);

    const result = await worker.filterProcessingNeeded(paths);

    expect(result.success).toBe(true);
    expect((result.data as string[]).length).toBe(950);
    // Verify all was called at least twice (batching)
    expect(mockStatement.all.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('recordMediaView - handles transaction error', async () => {
    mockDbInstance.exec.mockImplementationOnce(() => {
      throw new Error('Transaction failed');
    });

    const result = await worker.recordMediaView('/test.mp4');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Transaction failed');
  });

  it('getMediaViewCounts - handles error', async () => {
    mockStatement.all.mockImplementationOnce(() => {
      throw new Error('Query failed');
    });

    const result = await worker.getMediaViewCounts(['/test.mp4']);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Query failed');
  });

  it('getMediaViewCounts - handles large batch', async () => {
    const paths = Array.from({ length: 950 }, (_, i) => `/file${i}.mp4`);

    // Mock all to return some counts
    mockStatement.all.mockReturnValue([
      { file_path: '/file0.mp4', view_count: 5 },
    ]);

    const result = await worker.getMediaViewCounts(paths);

    expect(result.success).toBe(true);
    const map = result.data as Record<string, number>;
    expect(map['/file0.mp4']).toBe(5);
    expect(map['/file949.mp4']).toBe(0); // Default
    // Verify batching calls
    expect(mockStatement.all.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('cacheAlbums - handles error', async () => {
    mockStatement.run.mockImplementationOnce(() => {
      throw new Error('Cache failed');
    });

    const result = await worker.cacheAlbums('key', []);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cache failed');
  });

  it('addMediaDirectory - handles error', () => {
    mockStatement.run.mockImplementationOnce(() => {
      throw new Error('Add failed');
    });

    const result = worker.addMediaDirectory({ path: '/dir' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Add failed');
  });

  it('executeSmartPlaylist - handles invalid JSON', () => {
    const result = worker.executeSmartPlaylist('{ invalid json }');
    expect(result.success).toBe(false);
  });

  it('getRecentlyPlayed - handles error', () => {
    mockStatement.all.mockImplementationOnce(() => {
      throw new Error('Query failed');
    });

    const result = worker.getRecentlyPlayed(10);
    expect(result.success).toBe(false);
  });

  it('bulkUpsertMetadata - handles error', async () => {
    mockDbInstance.exec.mockImplementationOnce(() => {
      throw new Error('Bulk failed');
    });

    const result = await worker.bulkUpsertMetadata([{ filePath: '/test.mp4' }]);
    expect(result.success).toBe(false);
  });

  it('closeDatabase - handles error', () => {
    mockDbInstance.close.mockImplementationOnce(() => {
      throw new Error('Close failed');
    });

    const result = worker.closeDatabase();
    expect(result.success).toBe(false);
    expect(result.error).toBe('Close failed');
  });

  // Switch case coverage
  it('message handler - handles unknown message type', async () => {
    const handler = mockMessageHandlerRef.handler;
    if (handler) {
      await handler({ id: 1, type: 'UNKNOWN_TYPE', payload: {} });
      expect(mockPostMessageSpy).toHaveBeenCalledWith({
        id: 1,
        result: { success: false, error: 'Unknown message type: UNKNOWN_TYPE' },
      });
    } else {
      throw new Error('messageHandler not captured');
    }
  });

  it('message handler - handles getPendingMetadata when DB not ready', async () => {
    // Force DB to be null by closing it
    worker.closeDatabase();
    const handler = mockMessageHandlerRef.handler;
    if (handler) {
      await handler({ id: 2, type: 'getPendingMetadata', payload: {} });
      expect(mockPostMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 2,
          result: { success: false, error: 'DB not ready' },
        }),
      );
    }
  });

  it('message handler - handles error during processing', async () => {
    // Force an error in getAllMetadata
    mockGetMetadataStmt.all.mockImplementationOnce(() => {
      throw new Error('Processing failed');
    });

    const handler = mockMessageHandlerRef.handler;
    if (handler) {
      await handler({ id: 3, type: 'getAllMetadata', payload: {} });
      expect(mockPostMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 3,
          result: { success: false, error: 'Processing failed' },
        }),
      );
    }
  });
  it('upsertMetadata - handles undefined fields', async () => {
    // Should pass nulls to run
    const result = await worker.upsertMetadata({ filePath: '/test.mp4' });
    expect(result.success).toBe(true);
    // Verify run was called with nulls for optional fields
    expect(mockStatement.run).toHaveBeenCalledWith(
      expect.any(String), // fileId
      '/test.mp4',
      null, // duration
      null, // size
      null, // createdAt
      null, // rating
      null, // status
      null, // watchedSegments
      null, // playbackPosition
    );
  });

  it('bulkUpsertMetadata - handles undefined fields in batch', async () => {
    const result = await worker.bulkUpsertMetadata([{ filePath: '/test.mp4' }]);
    expect(result.success).toBe(true);

    expect(mockStatement.run).toHaveBeenCalledWith(
      expect.any(String),
      '/test.mp4',
      null, // duration
      null, // size
      null, // createdAt
      null, // rating
      null, // status
      null, // watchedSegments
      null, // playbackPosition
    );
  });

  it('getMetadata - handles batching and partial results', async () => {
    // Configure specific mocks
    mockGetMetadataStmt.all.mockReturnValue([]);

    // Mock file ID generation to simulate partial DB hit
    mockGetFileIdsStmt.all.mockImplementation(() => {
      return [{ file_path: '/hit.mp4', file_path_hash: 'hash1' }];
    });

    const result = await worker.getMetadata(['/hit.mp4', '/miss.mp4']);
    expect(result.success).toBe(true);
  });

  it('executeSmartPlaylist - filters by criteria', () => {
    const prepareSpy = mockDbInstance.prepare;

    // 1. Test Min Rating and Duration
    worker.executeSmartPlaylist(
      JSON.stringify({ minRating: 4, minDuration: 60 }),
    );
    let lastCall = prepareSpy.mock.calls[prepareSpy.mock.calls.length - 1];
    let sql = lastCall[0];
    expect(sql).toContain('rating >= ?');
    expect(sql).toContain('duration >= ?');

    // 2. Test Views
    worker.executeSmartPlaylist(
      JSON.stringify({ minViews: 10, maxViews: 100 }),
    );
    lastCall = prepareSpy.mock.calls[prepareSpy.mock.calls.length - 1];
    sql = lastCall[0];
    expect(sql).toContain('COALESCE(v.view_count, 0) >= ?');
    expect(sql).toContain('COALESCE(v.view_count, 0) <= ?');

    // 3. Test Days Since View
    worker.executeSmartPlaylist(JSON.stringify({ minDaysSinceView: 30 }));
    lastCall = prepareSpy.mock.calls[prepareSpy.mock.calls.length - 1];
    sql = lastCall[0];
    expect(sql).toContain("julianday('now') - julianday(v.last_viewed)) >= ?");
  });

  it('getMetadata - handles large batch', async () => {
    const paths = Array.from({ length: 950 }, (_, i) => `/file${i}.mp4`);

    // Mock file ID generation (all return valid)
    // We need to return an ID for each path to avoid fs.stat fallback overhead?
    // Or simplify: just return empty list from DB, so it falls back to generation (fs.stat mocked)
    // BUT generateFileIdsBatched ALSO has batching logic for DB lookup
    mockGetFileIdsStmt.all.mockImplementation(() => {
      // If args > 0, it's a batch query
      // Return some hits
      return [];
    });

    // Mock getMetadataBatch
    mockGetMetadataStmt.all.mockImplementation(() => {
      return [];
    });

    const result = await worker.getMetadata(paths);
    expect(result.success).toBe(true);
    expect(Object.keys(result.data as any).length).toBe(0); // Since we mocked empty return

    // Verify batch calls were made
    expect(mockGetFileIdsStmt.all).toHaveBeenCalled();
    expect(mockGetMetadataStmt.all).toHaveBeenCalled();
  });

  it('message handler - routes all known message types', async () => {
    const handler = mockMessageHandlerRef.handler;
    expect(handler).toBeDefined();

    const messageTypes = [
      { type: 'init', payload: { dbPath: ':memory:' } },
      { type: 'close', payload: {} },
      { type: 'upsertMetadata', payload: { filePath: '/t.mp4' } },
      { type: 'upsertMetadataBatch', payload: { payloads: [] } },
      { type: 'updateRating', payload: { filePath: '/t.mp4', rating: 5 } },
      {
        type: 'updateWatchedSegments',
        payload: { filePath: '/t.mp4', segments: '[]' },
      },
      { type: 'getAllMetadata', payload: {} },
      { type: 'getAllMetadataStats', payload: {} },
      { type: 'getAllMetadataVerification', payload: {} },
      { type: 'getMediaViewCounts', payload: { filePaths: [] } },
      { type: 'recordMediaView', payload: { filePath: '/t.mp4' } },
      { type: 'cacheAlbums', payload: { key: 'k', albums: [] } },
      { type: 'getCachedAlbum', payload: { key: 'k' } },
      { type: 'addMediaDirectory', payload: { path: '/d' } },
      { type: 'removeMediaDirectory', payload: { path: '/d' } },
      {
        type: 'setDirectoryActiveState',
        payload: { path: '/d', isActive: true },
      },
      { type: 'getMediaDirectories', payload: {} },
      { type: 'createSmartPlaylist', payload: { name: 'n', criteria: '{}' } },
      { type: 'getSmartPlaylists', payload: {} },
      { type: 'deleteSmartPlaylist', payload: { id: 1 } },
      {
        type: 'updateSmartPlaylist',
        payload: { id: 1, name: 'n', criteria: '{}' },
      },
      { type: 'saveSetting', payload: { key: 'k', value: 'v' } },
      { type: 'getSetting', payload: { key: 'k' } },
      { type: 'executeSmartPlaylist', payload: { criteria: '{}' } },
      { type: 'getRecentlyPlayed', payload: { limit: 10 } },
      { type: 'getPendingMetadata', payload: {} },
      { type: 'filterProcessingNeeded', payload: { filePaths: [] } },
      { type: 'getMetadata', payload: { filePaths: [] } },
      { type: 'addTranscodeJob', payload: { filePath: '/a.mp4' } },
      { type: 'listTranscodeJobs', payload: {} },
      {
        type: 'updateTranscodeJobStatus',
        payload: { filePath: '/a.mp4', status: 'done', error: null },
      },
      { type: 'deleteTranscodeJob', payload: { filePath: '/a.mp4' } },
      { type: 'getPendingTranscodeJobs', payload: {} },
    ];

    for (const [index, msg] of messageTypes.entries()) {
      await handler({ id: index + 100, type: msg.type, payload: msg.payload });
      expect(mockPostMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: index + 100,
        }),
      );
    }
  });
});
