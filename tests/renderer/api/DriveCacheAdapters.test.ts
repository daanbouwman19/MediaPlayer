import { describe, it, expect, vi } from 'vite-plus/test';
import { ElectronAdapter } from '../../../src/renderer/api/ElectronAdapter';
import { WebAdapter } from '../../../src/renderer/api/WebAdapter';
import type { DriveCacheProgressEvent } from '../../../src/shared/ipc/media.contract';

function progressEvent(
  fileId: string,
  overrides: Partial<DriveCacheProgressEvent> = {},
): DriveCacheProgressEvent {
  return {
    fileId,
    status: 'syncing',
    progress: 0.5,
    downloadedBytes: 50,
    totalSize: 100,
    ...overrides,
  };
}

function createBridge() {
  const listeners = new Set<(event: unknown, data: any) => void>();
  const bridge = {
    getDriveCacheStatus: vi.fn(),
    triggerDriveCache: vi.fn(),
    onDriveCacheProgress: vi.fn((callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  };
  const emit = (data: DriveCacheProgressEvent) => {
    for (const listener of listeners) listener({}, data);
  };
  return { bridge, emit, listeners };
}

describe('ElectronAdapter Drive offline cache', () => {
  it('supports the offline cache', () => {
    expect(new ElectronAdapter({} as any).supportsDriveOfflineCache).toBe(true);
  });

  it('unwraps the cache status', async () => {
    const { bridge } = createBridge();
    bridge.getDriveCacheStatus.mockResolvedValue({
      success: true,
      data: { status: 'ready', progress: 1 },
    });
    const adapter = new ElectronAdapter(bridge as any);

    await expect(adapter.getDriveCacheStatus('file-1')).resolves.toEqual({
      status: 'ready',
      progress: 1,
    });
    expect(bridge.getDriveCacheStatus).toHaveBeenCalledWith('file-1');
  });

  it('turns a failed trigger into a rejection carrying the reason', async () => {
    const { bridge } = createBridge();
    bridge.triggerDriveCache.mockResolvedValue({
      success: false,
      error: 'File is too large for the offline cache',
    });
    const adapter = new ElectronAdapter(bridge as any);

    await expect(adapter.triggerDriveCache('file-1')).rejects.toThrow(
      'File is too large for the offline cache',
    );
  });

  it('resolves a successful trigger', async () => {
    const { bridge } = createBridge();
    bridge.triggerDriveCache.mockResolvedValue({
      success: true,
      data: undefined,
    });
    const adapter = new ElectronAdapter(bridge as any);

    await expect(adapter.triggerDriveCache('file-1')).resolves.toBeUndefined();
  });

  it('shares one bridge subscription and delivers events only for the subscribed file', () => {
    const { bridge, emit, listeners } = createBridge();
    const adapter = new ElectronAdapter(bridge as any);
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();

    const offFirst = adapter.onDriveCacheProgress('file-1', first);
    const offSecond = adapter.onDriveCacheProgress('file-1', second);
    const offOther = adapter.onDriveCacheProgress('file-2', other);
    expect(bridge.onDriveCacheProgress).toHaveBeenCalledTimes(1);

    emit(progressEvent('file-1'));
    emit(progressEvent('file-3'));
    expect(first).toHaveBeenCalledWith(progressEvent('file-1'));
    expect(second).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();

    offFirst();
    offFirst(); // Unsubscribing twice is harmless.
    emit(progressEvent('file-1', { status: 'ready', progress: 1 }));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);

    offSecond();
    expect(listeners.size).toBe(1);
    offOther();
    expect(listeners.size).toBe(0);

    // A later subscription opens a new bridge subscription.
    adapter.onDriveCacheProgress('file-2', other);
    expect(bridge.onDriveCacheProgress).toHaveBeenCalledTimes(2);
    emit(progressEvent('file-2'));
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('WebAdapter Drive offline cache', () => {
  it('reports the offline cache as unsupported', async () => {
    const adapter = new WebAdapter();

    expect(adapter.supportsDriveOfflineCache).toBe(false);
    await expect(adapter.getDriveCacheStatus()).resolves.toEqual({
      status: 'cloud',
      progress: 0,
    });
    await expect(adapter.triggerDriveCache()).rejects.toThrow(
      'not supported in the web version',
    );
    const unsubscribe = adapter.onDriveCacheProgress();
    expect(() => unsubscribe()).not.toThrow();
  });
});
