import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  initDatabase,
  closeDatabase,
  upsertMetadata,
  recordMediaView,
  executeSmartPlaylist,
} from '../../src/core/database-worker';

describe('Smart Playlist SQL Generation', () => {
  const TEST_DB_PATH = path.join(__dirname, 'test_smart_playlist.sqlite');

  beforeAll(async () => {
    // Arrange: Clean up previous run
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    initDatabase(TEST_DB_PATH);

    // Arrange: Seed Data
    // Item 1: High rating, long duration
    await upsertMetadata({
      filePath: '/high-rating.mp4',
      duration: 500,
      rating: 5,
      size: 1000,
    });
    // Item 2: Low rating, short duration
    await upsertMetadata({
      filePath: '/low-rating.mp4',
      duration: 50,
      rating: 1,
      size: 500,
    });
    // Item 3: Medium rating, viewed
    await upsertMetadata({
      filePath: '/viewed.mp4',
      duration: 200,
      rating: 3,
      size: 750,
    });

    // Arrange: Record views for Item 3 (viewed now)
    await recordMediaView('/viewed.mp4');
    await recordMediaView('/viewed.mp4'); // 2 views
  });

  afterAll(() => {
    closeDatabase();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  interface TestCase {
    name: string;
    criteria: Record<string, unknown>;
    expectedCount: number;
    shouldContain?: string[];
    shouldNotContain?: string[];
  }

  const testCases: TestCase[] = [
    {
      name: 'filter by minRating',
      criteria: { minRating: 4 },
      expectedCount: 1,
      shouldContain: ['/high-rating.mp4'],
    },
    {
      name: 'filter by minDuration',
      criteria: { minDuration: 100 },
      expectedCount: 2,
      shouldContain: ['/high-rating.mp4', '/viewed.mp4'],
    },
    {
      name: 'filter by minViews',
      criteria: { minViews: 1 },
      expectedCount: 1,
      shouldContain: ['/viewed.mp4'],
    },
    {
      name: 'filter by maxViews',
      criteria: { maxViews: 0 },
      expectedCount: 2,
      shouldContain: ['/high-rating.mp4', '/low-rating.mp4'],
    },
    {
      name: 'handle multiple criteria',
      criteria: { minRating: 2, minDuration: 100 },
      expectedCount: 2,
      shouldContain: ['/high-rating.mp4', '/viewed.mp4'],
    },
    {
      name: 'handle minDaysSinceView = 1 (exclude recently viewed)',
      criteria: { minDaysSinceView: 1 },
      expectedCount: 2, // /high-rating.mp4 (never viewed) and /low-rating.mp4 (never viewed)
      shouldContain: ['/high-rating.mp4', '/low-rating.mp4'],
      shouldNotContain: ['/viewed.mp4'],
    },
    {
      name: 'handle minDaysSinceView = 0 (include everything)',
      criteria: { minDaysSinceView: 0 },
      expectedCount: 3,
    },
    {
      name: 'handle empty criteria (return all)',
      criteria: {},
      expectedCount: 3,
    },
  ];

  it.each(testCases)(
    'should $name',
    async ({ criteria, expectedCount, shouldContain, shouldNotContain }) => {
      // Act
      const result = await executeSmartPlaylist(JSON.stringify(criteria));

      // Assert
      expect(result.success).toBe(true);
      const rows = result.data as { file_path: string }[];
      expect(rows.length).toBe(expectedCount);

      if (shouldContain) {
        shouldContain.forEach((filePath) => {
          expect(rows.find((r) => r.file_path === filePath)).toBeDefined();
        });
      }

      if (shouldNotContain) {
        shouldNotContain.forEach((filePath) => {
          expect(rows.find((r) => r.file_path === filePath)).toBeUndefined();
        });
      }
    },
  );

  it('should return error for invalid JSON', async () => {
    // Act
    const result = await executeSmartPlaylist('{ invalid json }');

    // Assert
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
