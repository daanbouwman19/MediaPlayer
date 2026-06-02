import { describe, it, expect, vi, beforeEach } from 'vitest';
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

  it('initializes credentials if tokens are provided', async () => {
    const tokens = { refresh_token: 'abc' };
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue([]);

    await import('../../src/core/media/scan-worker');
    const callback = mockOn.mock.calls.find(
      (call) => call[0] === 'message',
    )?.[1];

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: {
        directories: ['/dir'],
        tokens,
      },
    });

    expect(googleAuth.initializeManualCredentials).toHaveBeenCalledWith(tokens);
    expect(mediaScanner.performFullMediaScan).toHaveBeenCalled();
  });

  it('registers message listener on startup', async () => {
    await import('../../src/core/media/scan-worker');
    expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('performs scan and posts results on START_SCAN', async () => {
    const albums = [{ id: '1' }];
    vi.mocked(mediaScanner.performFullMediaScan).mockResolvedValue(
      albums as any,
    );

    await import('../../src/core/media/scan-worker');

    // Get the callback
    const callback = mockOn.mock.calls.find(
      (call) => call[0] === 'message',
    )?.[1];
    expect(callback).toBeDefined();

    await callback({
      id: 1,
      type: 'START_SCAN',
      payload: { directories: ['/dir'] },
    });

    expect(mediaScanner.performFullMediaScan).toHaveBeenCalledWith(
      ['/dir'],
      expect.any(Set),
    );
    expect(mockPostMessage).toHaveBeenCalledWith({
      id: 1,
      result: { success: true, data: albums },
    });
  });

  it('handles errors during scan', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockRejectedValue(
      new Error('Fail'),
    );

    await import('../../src/core/media/scan-worker');
    const callback = mockOn.mock.calls.find(
      (call) => call[0] === 'message',
    )?.[1];
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
    await import('../../src/core/media/scan-worker');
    const callback = mockOn.mock.calls.find(
      (call) => call[0] === 'message',
    )?.[1];

    await callback({ id: 1, type: 'UNKNOWN', payload: {} });

    expect(mediaScanner.performFullMediaScan).not.toHaveBeenCalled();
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('handles non-Error objects in catch block', async () => {
    vi.mocked(mediaScanner.performFullMediaScan).mockRejectedValue(
      'String Error',
    );

    await import('../../src/core/media/scan-worker');
    const callback = mockOn.mock.calls.find(
      (call) => call[0] === 'message',
    )?.[1];

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
