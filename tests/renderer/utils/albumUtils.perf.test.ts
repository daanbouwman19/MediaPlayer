import { describe, it, expect } from 'vitest';
import {
  collectSelectedTextures,
  collectTexturesRecursive,
} from '../../../src/renderer/utils/albumUtils';
import type { Album, MediaFile } from '../../../src/core/media/types';

describe('albumUtils Performance/Stability', () => {
  it('collectSelectedTextures should handle very large albums without stack overflow', () => {
    const largeCount = 150000; // Exceeds typical stack limit (~65k-120k)
    const largeTextures: MediaFile[] = new Array(largeCount)
      .fill(null)
      .map((_, i) => ({
        name: `img${i}.jpg`,
        path: `/path/to/img${i}.jpg`,
      }));

    const album: Album = {
      id: 'large-album',
      name: 'Large Album',
      textures: largeTextures,
      children: [],
    };

    const selection = { 'large-album': true };

    // This should throw RangeError if using push(...spread)
    const result = collectSelectedTextures([album], selection);

    expect(result).toHaveLength(largeCount);
    expect(result[0].name).toBe('img0.jpg');
    expect(result[largeCount - 1].name).toBe(`img${largeCount - 1}.jpg`);
  });

  it('collectTexturesRecursive should handle very large albums', () => {
    const largeCount = 150000;
    const largeTextures: MediaFile[] = new Array(largeCount)
      .fill(null)
      .map((_, i) => ({
        name: `img${i}.jpg`,
        path: `/path/to/img${i}.jpg`,
      }));

    const album: Album = {
      id: 'large-album',
      name: 'Large Album',
      textures: largeTextures,
      children: [],
    };

    const result = collectTexturesRecursive(album);

    expect(result).toHaveLength(largeCount);
  });
});
