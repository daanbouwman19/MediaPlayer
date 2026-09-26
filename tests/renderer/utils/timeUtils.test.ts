import { describe, it, expect } from 'vite-plus/test';
import {
  formatTime,
  formatDurationForA11y,
} from '../../../src/renderer/utils/timeUtils';

describe('timeUtils', () => {
  describe('formatTime', () => {
    it.each([
      // Seconds to MM:SS
      { input: 0, expected: '00:00' },
      { input: 59, expected: '00:59' },
      { input: 60, expected: '01:00' },
      { input: 65, expected: '01:05' },
      { input: 599, expected: '09:59' },

      // Seconds to HH:MM:SS
      { input: 3600, expected: '1:00:00' },
      { input: 3665, expected: '1:01:05' },
      { input: 7200, expected: '2:00:00' },

      // Invalid inputs
      { input: -1, expected: '00:00' },
      { input: NaN, expected: '00:00' },
      { input: Infinity, expected: '00:00' },
      { input: undefined as any, expected: '00:00' },

      // Decimal seconds
      { input: 60.9, expected: '01:00' },
    ])('formats $input to $expected', ({ input, expected }) => {
      expect(formatTime(input)).toBe(expected);
    });
  });

  describe('formatDurationForA11y', () => {
    it.each([
      // 0 or invalid
      { input: 0, expected: '0 seconds' },
      { input: -10, expected: '0 seconds' },
      { input: NaN, expected: '0 seconds' },

      // Fractional seconds
      { input: 0.5, expected: '0 seconds' },

      // Seconds only
      { input: 30, expected: '30 seconds' },
      { input: 1, expected: '1 second' },

      // Minutes and seconds
      { input: 65, expected: '1 minute 5 seconds' },
      { input: 120, expected: '2 minutes' },

      // Hours, minutes, and seconds
      { input: 3665, expected: '1 hour 1 minute 5 seconds' },
      { input: 7200, expected: '2 hours' },
    ])('formats $input to "$expected"', ({ input, expected }) => {
      expect(formatDurationForA11y(input)).toBe(expected);
    });
  });
});
