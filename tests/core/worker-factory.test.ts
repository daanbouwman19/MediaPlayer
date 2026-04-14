import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerFactory } from '../../src/core/worker-factory';
import path from 'path';

describe('WorkerFactory', () => {
  const options = {
    currentDirname: '/app/src/core',
    currentUrl: 'file:///app/src/core/worker-factory.ts',
  };

  beforeEach(() => {
    vi.resetModules();
  });

  it('resolves path for non-electron dev environment', async () => {
    const result = await WorkerFactory.getWorkerPath('scan-worker', {
      ...options,
      isElectron: false,
    });
    expect(result.path).toContain('scan-worker.ts');
    expect(result.options?.execArgv).toContain('tsx');
  });

  it('resolves path for non-electron prod environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const result = await WorkerFactory.getWorkerPath('scan-worker', {
      ...options,
      isElectron: false,
    });
    expect(result.path).toBe(
      path.join(options.currentDirname, 'scan-worker.js'),
    );

    process.env.NODE_ENV = originalEnv;
  });

  it('resolves path for electron dev environment', async () => {
    const result = await WorkerFactory.getWorkerPath('scan-worker', {
      ...options,
      isElectron: true,
      isPackaged: false,
    });
    expect(result.path instanceof URL).toBe(true);
    expect((result.path as URL).href).toContain('scan-worker.js');
  });

  it('resolves path for electron packaged environment', async () => {
    const result = await WorkerFactory.getWorkerPath('scan-worker', {
      ...options,
      isElectron: true,
      isPackaged: true,
    });
    expect(result.path).toBe(
      path.join(options.currentDirname, 'scan-worker.js'),
    );
  });

  it('resolves path with electronAppPath', async () => {
    const result = await WorkerFactory.getWorkerPath('scan-worker', {
      ...options,
      isElectron: true,
      isPackaged: true,
      electronAppPath: '/app',
    });
    expect(result.path).toBe(
      path.join('/app', 'out', 'main', 'scan-worker.js'),
    );
  });

  it('resolves path for tests', async () => {
    const result = await WorkerFactory.getWorkerPath('scan-worker', {
      ...options,
      isElectron: true,
      isPackaged: false,
      isTest: true,
    });
    expect(result.path).toBe(
      path.resolve(process.cwd(), 'src', 'core', 'scan-worker.ts'),
    );
  });

  it('infers isElectron correctly', async () => {
    const originalElectron = process.versions.electron;
    (process.versions as any).electron = '1.0.0';

    const result = await WorkerFactory.getWorkerPath('scan-worker', options);
    expect(result.path instanceof URL).toBe(true);

    (process.versions as any).electron = originalElectron;
  });
});
