import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkerScannerService } from '../../../src/infrastructure/worker-scanner-service';
import { WorkerClient } from '../../../src/core/database/worker-client';
import { WorkerFactory } from '../../../src/core/database/worker-factory';

vi.mock('../../../src/core/database/worker-client');
vi.mock('../../../src/core/database/worker-factory');

describe('WorkerScannerService', () => {
  let service: WorkerScannerService;
  let mockClient: any;

  beforeEach(() => {
    service = new WorkerScannerService();
    mockClient = {
      init: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue([]),
      terminate: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(WorkerClient).mockImplementation(function () {
      return mockClient;
    });
    vi.mocked(WorkerFactory.getWorkerPath).mockResolvedValue({
      path: '/mock/worker.js',
      options: undefined,
    });
  });

  it('runs a scan successfully', async () => {
    const params = {
      directories: ['/test'],
      tokens: {},
      previousPaths: [],
    };

    const result = await service.runScan(params);

    expect(result).toEqual([]);
    expect(WorkerFactory.getWorkerPath).toHaveBeenCalled();
    expect(mockClient.init).toHaveBeenCalled();
    expect(mockClient.sendMessage).toHaveBeenCalledWith('START_SCAN', params);
    expect(mockClient.terminate).toHaveBeenCalled();
  });

  it('handles result being null', async () => {
    mockClient.sendMessage.mockResolvedValue(null);
    const result = await service.runScan({
      directories: [],
      tokens: null,
      previousPaths: [],
    });
    expect(result).toEqual([]);
  });

  it('cleans up even on error', async () => {
    mockClient.sendMessage.mockRejectedValue(new Error('Fail'));
    await expect(
      service.runScan({ directories: [], tokens: null, previousPaths: [] }),
    ).rejects.toThrow('Fail');
    expect(mockClient.terminate).toHaveBeenCalled();
  });

  it('handles electron environment', async () => {
    const originalVersions = process.versions;
    Object.defineProperty(process, 'versions', {
      value: { ...originalVersions, electron: '1.0.0' },
      configurable: true,
    });

    await service.runScan({ directories: [], tokens: null, previousPaths: [] });

    expect(WorkerFactory.getWorkerPath).toHaveBeenCalledWith(
      'scan-worker',
      expect.objectContaining({ isElectron: true }),
    );

    Object.defineProperty(process, 'versions', {
      value: originalVersions,
      configurable: true,
    });
  });

  it('handles production environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    await service.runScan({ directories: [], tokens: null, previousPaths: [] });

    expect(WorkerFactory.getWorkerPath).toHaveBeenCalledWith(
      'scan-worker',
      expect.objectContaining({
        currentDirname: expect.stringContaining('src/infrastructure'),
        currentUrl: expect.stringContaining('worker-scanner-service.ts'),
      }),
    );

    process.env.NODE_ENV = originalEnv;
  });
});
