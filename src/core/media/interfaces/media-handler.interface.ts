export interface IMediaHandler {
  getVideoDuration(
    filePath: string,
    ffmpegPath: string,
  ): Promise<{ duration: number } | { error: string }>;
}
