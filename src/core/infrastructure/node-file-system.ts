import fs from 'fs/promises';
import { IFileSystem } from '../interfaces/file-system.interface.ts';

export class NodeFileSystem implements IFileSystem {
  async stat(path: string) {
    const stats = await fs.stat(path);
    return {
      size: stats.size,
      birthtime: stats.birthtime,
    };
  }
}
