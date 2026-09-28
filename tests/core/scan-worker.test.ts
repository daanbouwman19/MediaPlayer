import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import * as mediaScanner from '../../src/core/media/media-scanner';

// Mock dependencies
vi.mock('../../src/core/media/media-scanner', () => ({
  performFullMediaScan: vi.fn(),
}));

// Mock worker_threads
const mockPostMessage = vi.fn();
const mockOn = vi.fn();

vi.mock('worker_threads', () => ({
  parentPort: {
    postMessage: mockPostMessage,
    on: mockOn,
  },
  default: {
    parentPort: {
      postMessage: mockPostMessage,
      on: mockOn,
    },
  },
}));

// Mock google-auth
vi.mock('../../src/main/google-auth', () => ({
  initializeManualCredentials: vi.fn(),
}));
import * as googleAuth from '../../src/main/google-auth';

describe('scan-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('initializes credentials if tokens are provided for a Drive source', async () => {
    const tokens = { refresh_token: 'abc' };
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue([]);

    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: {
        directories: ['/dir', 'gdrive://folder'],
        tokens,
      },
    });

    expect(googleAuth.initializeManualCredentials).toHaveBeenCalledWith(tokens);
    expect(mediaScanner.performFullMediaScan).toHaveBeenCalled();
  });

  it('registers the Drive backend for a Drive scan without tokens', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue([]);

    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');
    const { getDriveBackend } =
      await import('../../src/core/media/drive-backend');

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: { directories: ['gdrive://folder'] },
    });

    expect(() => getDriveBackend()).not.toThrow();
    expect(googleAuth.initializeManualCredentials).not.toHaveBeenCalled();
    expect(mediaScanner.performFullMediaScan).toHaveBeenCalledWith([
      'gdrive://folder',
    ]);
  });

  it('does not load the Google client for a purely local scan', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue([]);

    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: {
        directories: ['/dir'],
        tokens: { refresh_token: 'abc' },
      },
    });

    expect(googleAuth.initializeManualCredentials).not.toHaveBeenCalled();
    expect(mediaScanner.performFullMediaScan).toHaveBeenCalledWith(['/dir']);
  });

  it('does not statically import the Google Drive modules', async () => {
    // googleapis costs ~0.8 s and ~128 MB per scan worker, so the worker and
    // scanner must only load it on demand (dynamic import).
    const fs = await import('fs/promises');
    for (const file of [
      'src/core/media/scan-worker.ts',
      'src/core/media/media-scanner.ts',
    ]) {
      const source = await fs.readFile(file, 'utf8');
      expect(source).not.toMatch(
        /^import[^;]*from '[^']*(main\/google-|infrastructure\/google-drive-backend)/m,
      );
    }
  });

  it('registers message listener on startup', async () => {
    await import('../../src/core/media/scan-worker');
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('forwards messages from the registered listener to the handler', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue([]);
    await import('../../src/core/media/scan-worker');
    const listener = mockOn.mock.calls.find(
      (call) => call[0] === 'message',
    )?.[1];

    listener({ id: 7, type: 'START_SCAN', payload: { directories: [] } });

    await vi.waitFor(() =>
      expect(mockPostMessage).toHaveBeenCalledWith({
        id: 7,
        result: { success: true, data: [] },
      }),
    );
  });

  it('performs scan and posts results on START_SCAN', async () => {
    const albums = [{ id: '1' }];
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue(
      albums as any,
    );

    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');
    expect(callback).toBeDefined();

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: { directories: ['/dir'] },
    });

    expect(mediaScanner.performFullMediaScan).toHaveBeenCalledWith(['/dir']);
    expect(mockPostMessage).toHaveBeenCalledWith({
      id: 1,
      result: { success: true, data: albums },
    });
  });

  it('handles errors during scan', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockRejectedValue(
      new Error('Fail'),
    );

    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');
    expect(callback).toBeDefined();

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: { directories: ['/dir'] },
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      id: 1,
      result: { success: false, error: 'Fail' },
    });
  });

  it('ignores unknown message types', async () => {
    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');

    await callback({ id: 1, type: 'UNKNOWN', payload: {} });

    expect(mediaScanner.performFullMediaScan).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('handles non-Error objects in catch block', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockRejectedValue(
      'String Error',
    );

    const { handleScanMessage: callback } =
      await import('../../src/core/media/scan-worker');

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: { directories: ['/dir'] },
    });

    expect(mockPostMessage).toHaveBeenCalledWith({
      id: 1,
      result: { success: false, error: 'String Error' },
    });
  });
});
