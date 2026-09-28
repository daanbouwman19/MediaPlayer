import { describe, it, expect } from 'vite-plus/test';
import { parseHttpRange } from '../../../src/core/network/http-utils';

describe('parseHttpRange', () => {
  const DEFAULT_SIZE = 1000;
  const FULL = { start: 0, end: DEFAULT_SIZE - 1, partial: false };

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
      expected: FULL,
    },
    {
      name: 'returns full range when range header is empty',
      header: '',
      expected: FULL,
    },
    {
      name: 'parses a valid simple range',
      header: 'bytes=0-499',
      expected: { start: 0, end: 499, partial: true },
    },
    {
      name: 'parses a range with only start (offset to end)',
      header: 'bytes=500-',
      expected: { start: 500, end: DEFAULT_SIZE - 1, partial: true },
    },
    {
      name: 'parses a suffix range (last N bytes)',
      header: 'bytes=-100',
      expected: { start: 900, end: 999, partial: true },
    },
    {
      name: 'accepts the range unit case-insensitively',
      header: 'Bytes=10-19',
      expected: { start: 10, end: 19, partial: true },
    },
    {
      name: 'handles unsatisfiable ranges (start >= size)',
      header: 'bytes=1000-',
      expected: { start: 0, end: 0, partial: false, error: true },
    },
    {
      name: 'ignores a header without a unit (full content, not partial)',
      header: 'malformed',
      expected: FULL,
    },
    {
      name: 'ignores a malformed bytes range set (full content, not partial)',
      header: 'bytes=abc',
      expected: FULL,
    },
    {
      name: 'ignores ranges in a unit other than bytes (RFC 9110)',
      header: 'items=0-5',
      expected: FULL,
    },
    {
      name: 'handles zero size file with unsatisfiable range',
      header: 'bytes=0-',
      totalSize: 0,
      expected: { start: 0, end: 0, partial: false, error: true },
    },
    {
      name: 'parses single byte range',
      header: 'bytes=0-0',
      expected: { start: 0, end: 0, partial: true },
    },
    {
      name: 'handles zero size file with no range header',
      header: undefined,
      totalSize: 0,
      expected: { start: 0, end: -1, partial: false },
    },
    {
      name: 'ignores a non-bytes unit on a zero size file',
      header: 'items=0-5',
      totalSize: 0,
      expected: { start: 0, end: -1, partial: false },
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
