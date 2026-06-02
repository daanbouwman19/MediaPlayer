import { IFileSystem } from '../../src/core/media/interfaces/file-system.interface';

export class FakeFileSystem implements IFileSystem {
  private stats = new Map<string, { size: number; birthtime: Date }>();

  async stat(path: string): Promise<{ size: number; birthtime: Date }> {
    const stat = this.stats.get(path);
    if (!stat) {
      return { size: 0, birthtime: new Date() };
    }
    return stat;
  }

  setStat(path: string, size: number, birthtime: Date = new Date()) {
    this.stats.set(path, { size, birthtime });
  }
}
