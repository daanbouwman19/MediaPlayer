import type { Album } from '../types.ts';

export interface ScanResult {
  albums: Album[];
}

export interface IWorkerService {
  runScan(params: {
    directories: string[];
    tokens: unknown;
    previousPaths: string[];
  }): Promise<Album[]>;
}
