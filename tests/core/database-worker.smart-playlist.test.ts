import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use __mocks__/worker_threads.js so importing the worker module is safe.
vi.mock('worker_threads');

// Importing registers the mocked parentPort 'message' listener (unused here).
import '../../src/core/database/database-worker';
import {
  initDatabase,
  closeDatabase,
  upsertMetadata,
  executeSmartPlaylist,
} from '../../src/core/database/database-worker';

interface SmartPlaylistRow {
  file_path: string;
  playback_position: number | null;
  rating: number | null;
  [key: string]: unknown;
}

describe('executeSmartPlaylist - playback_position regression', () => {
  const ratedPath = '/library/rated.mp4';
  const RATED_POSITION = 42;

  beforeEach(async () => {
    initDatabase(':memory:');
    // A file that satisfies minRating:1 and carries a saved playback position.
    await upsertMetadata({
      filePath: ratedPath,
      duration: 120,
      rating: 3,
      playbackPosition: RATED_POSITION,
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('returns playback_position for the empty-criteria ({}) path', () => {
    const result = executeSmartPlaylist('{}');
    expect(result.success).toBe(true);

    const rows = result.data as SmartPlaylistRow[];
    const row = rows.find((r) => r.file_path === ratedPath);
    expect(row).toBeDefined();
    expect(row).toHaveProperty('playback_position');
    expect(row!.playback_position).toBe(RATED_POSITION);
  });

  it('returns playback_position for the dynamic-criteria ({"minRating":1}) path', () => {
    const result = executeSmartPlaylist('{"minRating":1}');
    expect(result.success).toBe(true);

    const rows = result.data as SmartPlaylistRow[];
    const row = rows.find((r) => r.file_path === ratedPath);
    // The rated file (rating 3) must match minRating:1 ...
    expect(row).toBeDefined();
    // ... and still carry playback_position on the dynamic query path.
    expect(row).toHaveProperty('playback_position');
    expect(row!.playback_position).toBe(RATED_POSITION);
  });

  it('keeps identical row shape between the {} and dynamic-criteria paths', () => {
    const emptyRows = executeSmartPlaylist('{}').data as SmartPlaylistRow[];
    const dynamicRows = executeSmartPlaylist('{"minRating":1}')
      .data as SmartPlaylistRow[];

    const emptyRow = emptyRows.find((r) => r.file_path === ratedPath)!;
    const dynamicRow = dynamicRows.find((r) => r.file_path === ratedPath)!;

    expect(Object.keys(dynamicRow).sort()).toEqual(
      Object.keys(emptyRow).sort(),
    );
    expect(Object.keys(emptyRow)).toContain('playback_position');
  });
});
