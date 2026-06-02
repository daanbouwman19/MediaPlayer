import { describe, it, expect } from 'vitest';
import {
  createSmartPlaylist,
  updateSmartPlaylist,
} from '../../src/core/database/database';

describe('Smart Playlist Validation', () => {
  it('should reject empty name', async () => {
    await expect(createSmartPlaylist('', '{}')).rejects.toThrow(
      'Invalid playlist name',
    );
  });

  it('should reject long name', async () => {
    const longName = 'a'.repeat(101);
    await expect(createSmartPlaylist(longName, '{}')).rejects.toThrow(
      'Invalid playlist name',
    );
  });

  it('should reject invalid JSON criteria', async () => {
    await expect(
      createSmartPlaylist('Valid Name', '{invalid_json'),
    ).rejects.toThrow('Criteria must be valid JSON');
  });

  it('should reject long criteria', async () => {
    const longCriteria = '{"a": "' + 'a'.repeat(10000) + '"}';
    await expect(
      createSmartPlaylist('Valid Name', longCriteria),
    ).rejects.toThrow('Invalid playlist criteria');
  });

  it('should reject non-string criteria', async () => {
    // @ts-expect-error Testing invalid input type
    await expect(createSmartPlaylist('Valid Name', 123)).rejects.toThrow(
      'Invalid playlist criteria',
    );
  });

  // Also test updateSmartPlaylist
  it('should reject invalid update', async () => {
    await expect(updateSmartPlaylist(1, '', '{}')).rejects.toThrow(
      'Invalid playlist name',
    );
  });
});
