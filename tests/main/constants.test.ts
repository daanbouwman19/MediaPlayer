import { describe, it, expect } from 'vitest';
import {
  MAX_DATA_URL_SIZE_MB,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
  ALL_SUPPORTED_EXTENSIONS,
} from '../../src/core/media/constants';

describe('Constants', () => {
  it('should have valid MAX_DATA_URL_SIZE_MB', () => {
    expect(MAX_DATA_URL_SIZE_MB).toBeDefined();
    expect(typeof MAX_DATA_URL_SIZE_MB).toBe('number');
    expect(MAX_DATA_URL_SIZE_MB).toBeGreaterThan(0);
  });

  it('should have supported image extensions', () => {
    expect(SUPPORTED_IMAGE_EXTENSIONS).toBeDefined();
    expect(Array.isArray(SUPPORTED_IMAGE_EXTENSIONS)).toBe(true);
    expect(SUPPORTED_IMAGE_EXTENSIONS.length).toBeGreaterThan(0);
    expect(SUPPORTED_IMAGE_EXTENSIONS).toContain('.png');
    expect(SUPPORTED_IMAGE_EXTENSIONS).toContain('.jpg');
  });

  it('should have supported video extensions', () => {
    expect(SUPPORTED_VIDEO_EXTENSIONS).toBeDefined();
    expect(Array.isArray(SUPPORTED_VIDEO_EXTENSIONS)).toBe(true);
    expect(SUPPORTED_VIDEO_EXTENSIONS.length).toBeGreaterThan(0);
    expect(SUPPORTED_VIDEO_EXTENSIONS).toContain('.mp4');
    expect(SUPPORTED_VIDEO_EXTENSIONS).toContain('.webm');
    expect(SUPPORTED_VIDEO_EXTENSIONS).toContain('.wmv');
    expect(SUPPORTED_VIDEO_EXTENSIONS).toContain('.flv');
  });

  it('should combine all extensions correctly', () => {
    expect(ALL_SUPPORTED_EXTENSIONS).toBeDefined();
    expect(Array.isArray(ALL_SUPPORTED_EXTENSIONS)).toBe(true);
    expect(ALL_SUPPORTED_EXTENSIONS.length).toBe(
      SUPPORTED_IMAGE_EXTENSIONS.length + SUPPORTED_VIDEO_EXTENSIONS.length,
    );
    // Check that it contains both image and video extensions
    expect(ALL_SUPPORTED_EXTENSIONS).toContain('.png');
    expect(ALL_SUPPORTED_EXTENSIONS).toContain('.mp4');
  });

  it('should have all extensions start with a dot', () => {
    const allExtensions = [
      ...SUPPORTED_IMAGE_EXTENSIONS,
      ...SUPPORTED_VIDEO_EXTENSIONS,
    ];
    allExtensions.forEach((ext) => {
      expect(ext).toMatch(/^\./);
    });
  });
});
