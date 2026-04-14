export interface IFileSystem {
  stat(path: string): Promise<{
    size: number;
    birthtime: Date;
  }>;
}
