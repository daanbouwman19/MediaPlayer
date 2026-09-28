import { describe, it, expect, vi } from 'vite-plus/test';
import { MediaDurationHandler } from '../../../src/infrastructure/media-duration-handler';
import * as mediaHandler from '../../../src/core/media/media-handler';
import { getProvider } from '../../../src/infrastructure/fs-provider-factory';

vi.mock('../../../src/core/media/media-handler', () => ({
  getVideoDuration: vi.fn(),
}));

vi.mock('../../../src/infrastructure/fs-provider-factory', () => ({
  getProvider: vi.fn(),
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

  it('reads file metadata through the matching provider', async () => {
    const meta = { size: 10, mimeType: 'video/mp4', duration: 3 };
    const getMetadata = vi.fn().mockResolvedValue(meta);
    vi.mocked(getProvider).mockReturnValue({ getMetadata } as any);

    const result = await new MediaDurationHandler().getFileMetadata(
      'gdrive://abc',
    );

    expect(getProvider).toHaveBeenCalledWith('gdrive://abc');
    expect(getMetadata).toHaveBeenCalledWith('gdrive://abc');
    expect(result).toBe(meta);
  });
});
