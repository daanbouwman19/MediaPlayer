import { describe, it, expect } from 'vitest';
import {
  WATCHED_THRESHOLD,
  isWatched,
} from '../../../src/renderer/utils/playbackUtils';

describe('playbackUtils', () => {
  it('exposes a single shared threshold', () => {
    expect(WATCHED_THRESHOLD).toBe(0.95);
  });

  describe('isWatched', () => {
    it('returns true at or above the threshold', () => {
      expect(isWatched(95, 100)).toBe(true);
      expect(isWatched(99, 100)).toBe(true);
      expect(isWatched(100, 100)).toBe(true);
    });

    it('returns false below the threshold', () => {
      expect(isWatched(50, 100)).toBe(false);
      expect(isWatched(94.9, 100)).toBe(false);
    });

    it('returns false for missing or invalid inputs', () => {
      expect(isWatched(undefined, 100)).toBe(false);
      expect(isWatched(0, 100)).toBe(false);
      expect(isWatched(null, 100)).toBe(false);
      expect(isWatched(50, undefined)).toBe(false);
      expect(isWatched(50, null)).toBe(false);
      expect(isWatched(50, 0)).toBe(false);
      expect(isWatched(50, -1)).toBe(false);
    });
  });
});
