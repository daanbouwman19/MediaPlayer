import { WorkerClient } from '../worker-client.ts';
import { WorkerFactory } from '../worker-factory.ts';
import { IWorkerService } from '../interfaces/worker-service.interface.ts';
import { fileURLToPath } from 'url';
import path from 'path';
import type { Album } from '../types.ts';
import { WORKER_SCAN_TIMEOUT_MS } from '../constants.ts';

export class WorkerScannerService implements IWorkerService {
  async runScan(params: {
    directories: string[];
    tokens: unknown;
    previousPaths: string[];
  }): Promise<Album[]> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const isElectron = !!process.versions['electron'];

    const { path: workerPath, options: workerOptions } =
      await WorkerFactory.getWorkerPath('scan-worker', {
        isElectron,
        currentDirname: __dirname,
        currentUrl: import.meta.url,
      });

    const client = new WorkerClient(workerPath, {
      workerOptions,
      operationTimeout: WORKER_SCAN_TIMEOUT_MS,
      name: 'scan-worker',
    });

    try {
      await client.init();
      const result = await client.sendMessage<Album[]>('START_SCAN', params);
      return result || [];
    } finally {
      await client.terminate();
    }
  }
}
