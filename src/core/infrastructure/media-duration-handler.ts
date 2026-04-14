import { IMediaHandler } from '../interfaces/media-handler.interface.ts';
import { getVideoDuration } from '../media-handler.ts';

export class MediaDurationHandler implements IMediaHandler {
  async getVideoDuration(filePath: string, ffmpegPath: string) {
    return getVideoDuration(filePath, ffmpegPath);
  }
}
