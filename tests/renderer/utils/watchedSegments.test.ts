import { describe, it, expect } from 'vite-plus/test';
import {
  addWatchedSegment,
  parseWatchedSegments,
} from '@/utils/watchedSegments';

describe('watchedSegments', () => {
  describe('parseWatchedSegments', () => {
    it('parses a stored list', () => {
      expect(
        parseWatchedSegments(
          JSON.stringify([
            { start: 0, end: 5 },
            { start: 10, end: 12.5 },
          ]),
        ),
      ).toEqual([
        { start: 0, end: 5 },
        { start: 10, end: 12.5 },
      ]);
    });

    it.each([null, undefined, '', 42, '{not json', '{"start":0}', '"text"'])(
      'returns [] for %s',
      (value) => {
        expect(parseWatchedSegments(value)).toEqual([]);
      },
    );

    it('drops invalid entries and extra fields', () => {
      expect(
        parseWatchedSegments(
          JSON.stringify([
            { start: 1, end: 2, extra: true },
            { start: 'a', end: 2 },
            { start: 5, end: 3 },
            { start: -1, end: 3 },
            null,
            7,
            { start: 4 },
          ]),
        ),
      ).toEqual([{ start: 1, end: 2 }]);
    });
  });

  describe('addWatchedSegment', () => {
    it('merges overlapping and nearly adjacent ranges, sorted', () => {
      const merged = addWatchedSegment(
        [
          { start: 20, end: 30 },
          { start: 0, end: 10 },
        ],
        { start: 10.3, end: 15 },
      );
      expect(merged).toEqual([
        { start: 0, end: 15 },
        { start: 20, end: 30 },
      ]);
    });

    it('keeps separate ranges apart and does not mutate the input', () => {
      const input = [{ start: 0, end: 10 }];
      const merged = addWatchedSegment(input, { start: 20, end: 25 });
      expect(merged).toEqual([
        { start: 0, end: 10 },
        { start: 20, end: 25 },
      ]);
      expect(input).toEqual([{ start: 0, end: 10 }]);

      const grown = addWatchedSegment(merged, { start: 5, end: 22 });
      expect(grown).toEqual([{ start: 0, end: 25 }]);
      expect(merged[0]).toEqual({ start: 0, end: 10 });
    });
  });
});
