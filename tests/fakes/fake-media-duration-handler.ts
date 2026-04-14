import { IMediaHandler } from '../../src/core/interfaces/media-handler.interface';

export class FakeMediaDurationHandler implements IMediaHandler {
  private durations = new Map<string, number>();

  async getVideoDuration(
    filePath: string,
    _ffmpegPath: string,
  ): Promise<{ duration: number } | { error: string }> {
    void _ffmpegPath;
    const duration = this.durations.get(filePath);
    if (duration === undefined) {
      return { duration: 0 };
    }
    return { duration };
  }

  setDuration(filePath: string, duration: number) {
    this.durations.set(filePath, duration);
  }
}
