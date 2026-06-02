import { WorkerClient } from '../core/database/worker-client.ts';
import { WorkerFactory } from '../core/database/worker-factory.ts';
import { IWorkerService } from '../core/media/interfaces/worker-service.interface.ts';
import { fileURLToPath } from 'url';
import path from 'path';
import type { Album } from '../core/media/types.ts';
import { WORKER_SCAN_TIMEOUT_MS } from '../core/media/constants.ts';

const WORKER_FILENAME = fileURLToPath(import.meta.url);
const WORKER_DIRNAME = path.dirname(WORKER_FILENAME);

export class WorkerScannerService implements IWorkerService {
  async runScan(params: {
    directories: string[];
    tokens: unknown;
    previousPaths: string[];
  }): Promise<Album[]> {
    const isElectron = !!process.versions['electron'];

    const isProd = process.env.NODE_ENV === 'production';
    const currentDirname = isProd
      ? WORKER_DIRNAME
      : path.join(WORKER_DIRNAME, '..');
    const currentUrl = isProd
      ? import.meta.url
      : new URL('../core/media/', import.meta.url).href;

    const { path: workerPath, options: workerOptions } =
      await WorkerFactory.getWorkerPath('scan-worker', {
        isElectron,
        currentDirname,
        currentUrl,
        workerDir: path.join(currentDirname, 'core/media'),
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
