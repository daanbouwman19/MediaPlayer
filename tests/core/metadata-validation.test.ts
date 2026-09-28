import { describe, it, expect } from 'vite-plus/test';
import {
  MAX_WATCHED_SEGMENTS,
  MAX_WATCHED_SEGMENTS_JSON_LENGTH,
  normalizeWatchedSegments,
  parseMetadataUpdate,
} from '../../src/core/database/metadata-validation';
import { AppError } from '../../src/core/media/errors';

const expectBadRequest = (fn: () => unknown, message?: string | RegExp) => {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).statusCode).toBe(400);
  if (message) expect((caught as AppError).message).toMatch(message);
};

describe('parseMetadataUpdate', () => {
  it('keeps every known field when valid', () => {
    const input = {
      duration: 12.5,
      size: 1024,
      rating: 5,
      createdAt: '2024-01-02T03:04:05.000Z',
      status: 'success',
      watchedSegments: JSON.stringify([{ start: 0, end: 4 }]),
      playbackPosition: 3.25,
    };
    expect(parseMetadataUpdate(input)).toEqual(input);
  });

  it('drops unknown keys, including a filePath override', () => {
    const result = parseMetadataUpdate({
      rating: 2,
      filePath: 'gdrive://someone-elses-file',
      in_library: 1,
      title: 'x',
    });
    expect(result).toEqual({ rating: 2 });
    expect(Object.keys(result)).toEqual(['rating']);
  });

  it('treats null like a missing field and adds no undefined keys', () => {
    const result = parseMetadataUpdate({ rating: null, duration: undefined });
    expect(result).toEqual({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it.each([
    ['a string', 'meta'],
    ['null', null],
    ['an array', [1]],
  ])('rejects %s as metadata', (_label, input) => {
    expectBadRequest(() => parseMetadataUpdate(input), 'must be an object');
  });

  it.each([
    ['duration', -1],
    ['duration', Number.POSITIVE_INFINITY],
    ['duration', '10'],
    ['size', 1.5],
    ['size', -3],
    ['rating', 6],
    ['rating', -1],
    ['rating', 2.5],
    ['rating', '5'],
    ['createdAt', 'not a date'],
    ['createdAt', 12345],
    ['createdAt', `2024-01-01T00:00:00Z${' '.repeat(100)}`],
    ['status', 'hacked'],
    ['status', 1],
    ['playbackPosition', -0.5],
    ['playbackPosition', Number.NaN],
  ])('rejects an invalid %s (%j)', (field, value) => {
    expectBadRequest(
      () => parseMetadataUpdate({ [field]: value }),
      new RegExp(field),
    );
  });

  it('validates watchedSegments with the segment rules', () => {
    expectBadRequest(
      () => parseMetadataUpdate({ watchedSegments: '{oops' }),
      'valid JSON',
    );
  });
});

describe('normalizeWatchedSegments', () => {
  it('re-serialises valid segments', () => {
    const json = JSON.stringify([
      { start: 0, end: 5 },
      { start: 10, end: 12.5 },
    ]);
    expect(JSON.parse(normalizeWatchedSegments(json))).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 12.5 },
    ]);
  });

  it('drops entries that cannot be stored and extra properties', () => {
    const json = JSON.stringify([
      { start: null, end: 4 }, // NaN serialises to null
      { start: 3, end: 1 }, // reversed
      { start: -1, end: 2 },
      { start: 1 },
      7,
      null,
      { start: 1, end: 2, label: 'x' },
    ]);
    expect(JSON.parse(normalizeWatchedSegments(json))).toEqual([
      { start: 1, end: 2 },
    ]);
  });

  it('rejects non-string input', () => {
    expectBadRequest(
      () => normalizeWatchedSegments([{ start: 0, end: 1 }]),
      'JSON string',
    );
  });

  it('rejects malformed JSON and non-arrays', () => {
    expectBadRequest(() => normalizeWatchedSegments('[{start:0}]'), 'JSON');
    expectBadRequest(() => normalizeWatchedSegments('{}'), 'JSON array');
  });

  it('rejects more than MAX_WATCHED_SEGMENTS entries', () => {
    const segments = Array.from(
      { length: MAX_WATCHED_SEGMENTS + 1 },
      (_, i) => ({ start: i, end: i + 0.5 }),
    );
    expectBadRequest(
      () => normalizeWatchedSegments(JSON.stringify(segments)),
      'Too many watched segments',
    );
    const atLimit = JSON.stringify(segments.slice(0, MAX_WATCHED_SEGMENTS));
    expect(JSON.parse(normalizeWatchedSegments(atLimit))).toHaveLength(
      MAX_WATCHED_SEGMENTS,
    );
  });

  it('rejects oversized payloads before parsing them', () => {
    const huge = `[${' '.repeat(MAX_WATCHED_SEGMENTS_JSON_LENGTH)}]`;
    expectBadRequest(() => normalizeWatchedSegments(huge), 'too large');
  });
});
