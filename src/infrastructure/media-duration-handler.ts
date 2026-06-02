import { IMediaHandler } from '../core/media/interfaces/media-handler.interface.ts';
import { getVideoDuration } from '../core/media/media-handler.ts';

export class MediaDurationHandler implements IMediaHandler {
  async getVideoDuration(filePath: string, ffmpegPath: string) {
    return getVideoDuration(filePath, ffmpegPath);
  }
}
