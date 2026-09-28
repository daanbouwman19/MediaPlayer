import { describe, it, expect } from 'vite-plus/test';
import {
  pickRandomStartTime,
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

describe('pickRandomStartTime', () => {
  it('leaves the tail to play', () => {
    expect(pickRandomStartTime(100, 5, () => 0.5)).toBe(47);
    expect(pickRandomStartTime(100, 5, () => 0.999)).toBe(94);
    expect(pickRandomStartTime(100, 5, () => 0)).toBe(0);
  });

  it('returns 0 for short or unknown durations', () => {
    expect(pickRandomStartTime(5, 5, () => 0.5)).toBe(0);
    expect(pickRandomStartTime(6, 5, () => 0.5)).toBe(0);
    expect(pickRandomStartTime(0, 5)).toBe(0);
    expect(pickRandomStartTime(Number.NaN, 5)).toBe(0);
  });

  it('treats a negative tail as none', () => {
    expect(pickRandomStartTime(10, -3, () => 0.5)).toBe(5);
  });

  it('uses Math.random by default', () => {
    const value = pickRandomStartTime(100, 0);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(100);
  });
});
