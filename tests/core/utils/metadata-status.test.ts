import { describe, it, expect } from 'vite-plus/test';
import { isMetadataComplete } from '../../../src/core/media/utils/metadata-status';

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
