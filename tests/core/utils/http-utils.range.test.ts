import { describe, it, expect } from 'vitest';
import { parseHttpRange } from '../../../src/core/network/http-utils';

describe('parseHttpRange', () => {
  const DEFAULT_SIZE = 1000;

  type TestCase = {
    name: string;
    header: string | undefined;
    expected: ReturnType<typeof parseHttpRange>;
    totalSize?: number;
  };

  const testCases: TestCase[] = [
    {
      name: 'returns full range when no range header is provided',
      header: undefined,
      expected: { start: 0, end: DEFAULT_SIZE - 1 },
    },
    {
      name: 'returns full range when range header is empty',
      header: '',
      expected: { start: 0, end: DEFAULT_SIZE - 1 },
    },
    {
      name: 'parses a valid simple range',
      header: 'bytes=0-499',
      expected: { start: 0, end: 499 },
    },
    {
      name: 'parses a range with only start (offset to end)',
      header: 'bytes=500-',
      expected: { start: 500, end: DEFAULT_SIZE - 1 },
    },
    {
      name: 'parses a suffix range (last N bytes)',
      header: 'bytes=-100',
      expected: { start: 900, end: 999 },
    },
    {
      name: 'handles unsatisfiable ranges (start >= size)',
      header: 'bytes=1000-',
      expected: { start: 0, end: 0, error: true },
    },
    {
      name: 'handles malformed ranges by defaulting to full content',
      header: 'malformed',
      expected: { start: 0, end: DEFAULT_SIZE - 1 },
    },
    {
      name: 'handles zero size file with unsatisfiable range',
      header: 'bytes=0-',
      totalSize: 0,
      expected: { start: 0, end: 0, error: true },
    },
    {
      name: 'parses single byte range',
      header: 'bytes=0-0',
      expected: { start: 0, end: 0 },
    },
    {
      name: 'handles zero size file with no range header',
      header: undefined,
      totalSize: 0,
      expected: { start: 0, end: -1 },
    },
  ];

  it.each(testCases)(
    '$name',
    ({ header, expected, totalSize = DEFAULT_SIZE }) => {
      const result = parseHttpRange(totalSize, header);
      expect(result).toEqual(expected);
    },
  );
});
