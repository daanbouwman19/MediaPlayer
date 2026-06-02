/**
 * @file Centralized worker path resolution.
 */
import path from 'path';

export type WorkerName = 'scan-worker' | 'database-worker';

export interface WorkerFactoryOptions {
  currentDirname: string;
  currentUrl: string;
  isElectron?: boolean;
  isPackaged?: boolean;
  isTest?: boolean;
  electronAppPath?: string;
  workerDir?: string;
  serverWorkerAlias?: string;
}

export class WorkerFactory {
  static async getWorkerPath(
    workerName: WorkerName,
    options: WorkerFactoryOptions,
  ): Promise<{ path: string | URL; options?: { execArgv: string[] } }> {
    const isElectron = options.isElectron ?? !!process.versions.electron;
    let isPackaged = options.isPackaged;
    if (isElectron && isPackaged === undefined) {
      try {
        const { app } = await import('electron');
        isPackaged = app.isPackaged;
      } catch {
        isPackaged = false;
      }
    }

    let workerPath: string | URL;
    let workerOptions: { execArgv: string[] } | undefined;

    if (isElectron) {
      if (isPackaged) {
        if (options.electronAppPath) {
          workerPath = path.join(
            options.electronAppPath,
            'out',
            'main',
            `${workerName}.js`,
          );
        } else {
          workerPath = path.join(options.currentDirname, `${workerName}.js`);
        }
      } else if (options.isTest === true) {
        const subDir = workerName === 'database-worker' ? 'database' : 'media';
        workerPath = path.resolve(
          process.cwd(),
          'src',
          'core',
          subDir,
          `${workerName}.ts`,
        );
      } else {
        workerPath = new URL(`./${workerName}.js`, options.currentUrl);
      }
    } else {
      if (process.env.NODE_ENV === 'production') {
        const fileName = options.serverWorkerAlias ?? workerName;
        workerPath = path.join(options.currentDirname, `${fileName}.js`);
      } else {
        const baseDir = options.workerDir ?? options.currentDirname;
        workerPath = path.join(baseDir, `${workerName}.ts`);
        workerOptions = { execArgv: ['--import', 'tsx'] };
      }
    }

    return { path: workerPath, options: workerOptions };
  }
}
