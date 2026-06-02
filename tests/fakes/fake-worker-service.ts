import { IWorkerService } from '../../src/core/media/interfaces/worker-service.interface';
import { Album } from '../../src/core/media/types';

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
