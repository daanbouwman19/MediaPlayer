import { WorkerClient } from '../worker-client.ts';
import { WorkerFactory } from '../worker-factory.ts';
import { IWorkerService } from '../interfaces/worker-service.interface.ts';
import { fileURLToPath } from 'url';
import path from 'path';
import type { Album } from '../types.ts';
import { WORKER_SCAN_TIMEOUT_MS } from '../constants.ts';

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
      : new URL('../', import.meta.url).href;

    const { path: workerPath, options: workerOptions } =
      await WorkerFactory.getWorkerPath('scan-worker', {
        isElectron,
        currentDirname,
        currentUrl,
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
