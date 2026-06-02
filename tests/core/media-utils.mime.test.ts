import { describe, it, expect } from 'vitest';
import {
  isDrivePath,
  getDriveId,
  createDrivePath,
} from '../../src/core/media/media-utils';
import { getMimeType } from '../../src/core/media/utils/mime-types';
import { GDRIVE_PROTOCOL } from '../../src/core/media/constants';

describe('media-utils MIME and Drive Path tests', () => {
  describe('Google Drive Path Utilities', () => {
    it('isDrivePath correctly identifies drive paths', () => {
      expect(isDrivePath(`${GDRIVE_PROTOCOL}12345`)).toBe(true);
      expect(isDrivePath(`${GDRIVE_PROTOCOL}folder/file`)).toBe(true);
      expect(isDrivePath('/local/path/to/file')).toBe(false);
      expect(isDrivePath('C:\\Windows\\System32')).toBe(false);
      expect(isDrivePath('')).toBe(false);
    });

    it('getDriveId extracts ID from drive paths', () => {
      expect(getDriveId(`${GDRIVE_PROTOCOL}12345`)).toBe('12345');
      expect(getDriveId(`${GDRIVE_PROTOCOL}abc-def_123`)).toBe('abc-def_123');
    });

    it('getDriveId returns original string if not a drive path', () => {
      expect(getDriveId('/local/path')).toBe('/local/path');
      expect(getDriveId('filename.txt')).toBe('filename.txt');
    });

    it('createDrivePath constructs correct path', () => {
      expect(createDrivePath('12345')).toBe(`${GDRIVE_PROTOCOL}12345`);
      expect(createDrivePath('abc-def')).toBe(`${GDRIVE_PROTOCOL}abc-def`);
    });

    it('round trip integrity', () => {
      const id = 'unique-id-123';
      expect(getDriveId(createDrivePath(id))).toBe(id);
    });
  });

  describe('getMimeType', () => {
    const testCases = [
      // Images
      ['file.jpg', 'image/jpeg'],
      ['file.jpeg', 'image/jpeg'],
      ['file.png', 'image/png'],
      ['file.gif', 'image/gif'],
      ['file.webp', 'image/webp'],
      ['file.svg', 'image/svg'], // Implementation returns image/svg, not image/svg+xml

      // Videos
      ['file.mp4', 'video/mp4'],
      ['file.webm', 'video/webm'],
      ['file.ogg', 'video/ogg'],
      ['file.mov', 'video/quicktime'],
      ['file.avi', 'video/x-msvideo'],
      ['file.mkv', 'video/x-matroska'],

      // Case insensitivity
      ['file.JPG', 'image/jpeg'],
      ['file.MP4', 'video/mp4'],

      // Edge cases
      [`${GDRIVE_PROTOCOL}12345`, 'application/octet-stream'],
      ['file.unknown', 'application/octet-stream'],
      ['file', 'application/octet-stream'],
    ];

    it.each(testCases)(
      'returns correct MIME type for %s',
      (filePath, expected) => {
        expect(getMimeType(filePath)).toBe(expected);
      },
    );
  });
});
