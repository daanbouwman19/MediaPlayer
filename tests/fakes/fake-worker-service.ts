import { IWorkerService } from '../../src/core/interfaces/worker-service.interface';
import { Album } from '../../src/core/types';

export class FakeWorkerService implements IWorkerService {
  private result: Album[] = [];

  async runScan(_params: {
    directories: string[];
    tokens: unknown;
    previousPaths: string[];
  }): Promise<Album[]> {
    void _params;
    return this.result;
  }

  setScanResult(albums: Album[]) {
    this.result = albums;
  }
}
