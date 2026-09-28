import { describe, it, expect } from 'vite-plus/test';
import {
  EXTRACTION_RETRY_BASE_MS,
  EXTRACTION_RETRY_MAX_MS,
  extractionRetryDelayMs,
  isExtractionBackedOff,
  isMetadataComplete,
} from '../../../src/core/media/utils/metadata-status';

describe('isMetadataComplete', () => {
  it.each(['pending', 'processing', 'failed', null, undefined])(
    'is incomplete while the status is %s',
    (status) => {
      expect(isMetadataComplete('/m/photo.jpg', status, undefined)).toBe(false);
      expect(isMetadataComplete('/m/clip.mp4', status, 12)).toBe(false);
    },
  );

  it('needs only a success status for images and Drive files', () => {
    expect(isMetadataComplete('/m/photo.jpg', 'success', null)).toBe(true);
    expect(isMetadataComplete('gdrive://abc', 'success', null)).toBe(true);
  });

  it('needs a real duration for a video', () => {
    expect(isMetadataComplete('/m/clip.MP4', 'success', 12.5)).toBe(true);
    for (const duration of [null, undefined, 0, -1, Number.NaN, '12']) {
      expect(isMetadataComplete('/m/clip.mp4', 'success', duration)).toBe(
        false,
      );
    }
  });
});

describe('extraction retry backoff', () => {
  const HOUR = 60 * 60 * 1000;
  const now = 1_000_000_000_000;

  it('waits one hour after the first failure, doubling up to a week', () => {
    expect(extractionRetryDelayMs(0)).toBe(EXTRACTION_RETRY_BASE_MS);
    expect(extractionRetryDelayMs(1)).toBe(HOUR);
    expect(extractionRetryDelayMs(2)).toBe(2 * HOUR);
    expect(extractionRetryDelayMs(4)).toBe(8 * HOUR);
    expect(extractionRetryDelayMs(100)).toBe(EXTRACTION_RETRY_MAX_MS);
  });

  it('backs off a failed row inside its window only', () => {
    expect(isExtractionBackedOff('failed', 1, now - HOUR + 1, now)).toBe(true);
    expect(isExtractionBackedOff('failed', 1, now - HOUR, now)).toBe(false);
    expect(isExtractionBackedOff('failed', 3, now - 3 * HOUR, now)).toBe(true);
    expect(isExtractionBackedOff('failed', 3, now - 4 * HOUR, now)).toBe(false);
  });

  it('never backs off other statuses or rows without an attempt record', () => {
    expect(isExtractionBackedOff('success', 1, now, now)).toBe(false);
    expect(isExtractionBackedOff('pending', 1, now, now)).toBe(false);
    expect(isExtractionBackedOff('failed', 0, now, now)).toBe(false);
    expect(isExtractionBackedOff('failed', null, now, now)).toBe(false);
    expect(isExtractionBackedOff('failed', 1, null, now)).toBe(false);
    expect(isExtractionBackedOff('failed', 1, Number.NaN, now)).toBe(false);
  });
});
