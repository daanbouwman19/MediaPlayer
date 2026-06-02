import { describe, it, expect, vi, beforeEach, afterEach, test } from 'vitest';
import {
  isDrivePath,
  getDriveId,
  createDrivePath,
  getThumbnailCachePath,
  normalizeFilePath,
} from '../../src/core/media/media-utils';
import path from 'path';

describe('media-utils unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Drive Helpers', () => {
    it('isDrivePath correctly identifies drive paths', () => {
      expect(isDrivePath('gdrive://123')).toBe(true);
      expect(isDrivePath('/local/path')).toBe(false);
    });

    it('getDriveId extracts ID from drive path', () => {
      expect(getDriveId('gdrive://123')).toBe('123');
    });

    it('getDriveId returns original path if not drive path', () => {
      expect(getDriveId('/local/path')).toBe('/local/path');
    });

    it('createDrivePath creates correct path', () => {
      expect(createDrivePath('123')).toBe('gdrive://123');
    });
  });

  describe('Thumbnail Utils', () => {
    it('getThumbnailCachePath generates correct path based on hash', () => {
      const filePath = '/test/video.mp4';
      const cacheDir = '/cache';
      const result = getThumbnailCachePath(filePath, cacheDir);

      // Match path ending with /cache/<hash>.jpg, allowing either / or \ separator
      expect(result).toMatch(/[\\/]cache[\\/][a-f0-9]+\.jpg$/);

      // Verify validation logic works with platform specific check
      expect(result.startsWith(path.join(cacheDir))).toBe(true);
    });
  });

  describe('normalizeFilePath', () => {
    test.each([
      {
        desc: 'standard linux path',
        input: '/path/to/file',
        platform: 'linux',
        expected: '/path/to/file',
      },
      {
        desc: 'windows path with leading slash',
        input: '/C:/Windows/System32',
        platform: 'win32',
        expected: 'C:/Windows/System32',
      },
      {
        desc: 'windows-like path on linux',
        input: '/C:/Windows',
        platform: 'linux',
        expected: '/C:/Windows',
      },
      {
        desc: 'encoded URI components',
        input: '/path%20to/file',
        platform: 'linux',
        expected: '/path to/file',
      },
      {
        desc: 'empty string',
        input: '',
        platform: 'linux',
        expected: '',
      },
      {
        desc: 'root path on windows (removes slash)',
        input: '/',
        platform: 'win32',
        expected: '',
      },
      {
        desc: 'windows path without leading slash',
        input: 'C:/Windows',
        platform: 'win32',
        expected: 'C:/Windows',
      },
      {
        desc: 'encoded slash on windows',
        input: '%2F',
        platform: 'win32',
        expected: '',
      },
      {
        desc: 'encoded slash on linux',
        input: '%2F',
        platform: 'linux',
        expected: '/',
      },
    ])(
      '$desc: "$input" on $platform -> "$expected"',
      ({
        input,
        platform,
        expected,
      }: {
        input: string;
        platform: string;
        expected: string;
      }) => {
        expect(normalizeFilePath(input, platform)).toBe(expected);
      },
    );
  });
});
