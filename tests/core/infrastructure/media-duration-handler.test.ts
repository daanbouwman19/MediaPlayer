import { describe, it, expect, vi } from 'vitest';
import { MediaDurationHandler } from '../../../src/infrastructure/media-duration-handler';
import * as mediaHandler from '../../../src/core/media/media-handler';

vi.mock('../../../src/core/media/media-handler', () => ({
  getVideoDuration: vi.fn(),
}));

describe('MediaDurationHandler', () => {
  it('calls getVideoDuration from media-handler', async () => {
    const handler = new MediaDurationHandler();
    const mockDuration = { duration: 120 };
    vi.mocked(mediaHandler.getVideoDuration).mockResolvedValue(mockDuration);

    const result = await handler.getVideoDuration(
      '/path/to/video.mp4',
      '/path/to/ffmpeg',
    );

    expect(result).toEqual(mockDuration);
    expect(mediaHandler.getVideoDuration).toHaveBeenCalledWith(
      '/path/to/video.mp4',
      '/path/to/ffmpeg',
    );
  });
});
