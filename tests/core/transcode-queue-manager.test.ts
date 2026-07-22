// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAddTranscodeJob,
  mockUpdateTranscodeJobStatus,
  mockGetPendingTranscodeJobs,
  mockEnsureSessionUnthrottled,
  mockPinSession,
  mockUnpinSession,
  mockWaitForSession,
  mockStopSession,
  mockGenerateSessionId,
} = vi.hoisted(() => ({
  mockAddTranscodeJob: vi.fn().mockResolvedValue(undefined),
  mockUpdateTranscodeJobStatus: vi.fn().mockResolvedValue(undefined),
  mockGetPendingTranscodeJobs: vi.fn().mockResolvedValue([]),
  mockEnsureSessionUnthrottled: vi.fn().mockResolvedValue('/hls/session.m3u8'),
  mockPinSession: vi.fn(),
  mockUnpinSession: vi.fn(),
  mockWaitForSession: vi.fn().mockResolvedValue('complete'),
  mockStopSession: vi.fn().mockResolvedValue(undefined),
  mockGenerateSessionId: vi.fn().mockResolvedValue('sess-abc'),
}));

vi.mock('../../src/core/database/database.ts', () => ({
  addTranscodeJob: mockAddTranscodeJob,
  updateTranscodeJobStatus: mockUpdateTranscodeJobStatus,
  getPendingTranscodeJobs: mockGetPendingTranscodeJobs,
}));

vi.mock('../../src/core/media/hls-manager.ts', () => ({
  HlsSessionStatus: {
    STARTING: 'starting',
    ACTIVE: 'active',
    ERROR: 'error',
    STOPPED: 'stopped',
    COMPLETE: 'complete',
  },
  HlsManager: {
    getInstance: vi.fn(() => ({
      ensureSessionUnthrottled: mockEnsureSessionUnthrottled,
      pinSession: mockPinSession,
      unpinSession: mockUnpinSession,
      waitForSession: mockWaitForSession,
      stopSession: mockStopSession,
    })),
  },
}));

vi.mock('../../src/core/media/hls-handler.ts', () => ({
  generateSessionId: mockGenerateSessionId,
}));

import { TranscodeQueueManager } from '../../src/core/media/transcode-queue-manager.ts';

describe('TranscodeQueueManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TranscodeQueueManager.resetInstance();
    mockGetPendingTranscodeJobs.mockResolvedValue([]);
    mockEnsureSessionUnthrottled.mockResolvedValue('/hls/session.m3u8');
    mockWaitForSession.mockResolvedValue('complete');
    mockStopSession.mockResolvedValue(undefined);
    mockGenerateSessionId.mockResolvedValue('sess-abc');
  });

  it('getInstance returns singleton', () => {
    const a = TranscodeQueueManager.getInstance();
    const b = TranscodeQueueManager.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance clears singleton', () => {
    const a = TranscodeQueueManager.getInstance();
    TranscodeQueueManager.resetInstance();
    const b = TranscodeQueueManager.getInstance();
    expect(a).not.toBe(b);
  });

  it('start with no pending jobs does nothing', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await manager.start();
    expect(mockGetPendingTranscodeJobs).toHaveBeenCalled();
    expect(mockUpdateTranscodeJobStatus).not.toHaveBeenCalled();
  });

  it('start handles null result from getPendingTranscodeJobs', async () => {
    mockGetPendingTranscodeJobs.mockResolvedValue(null as any);
    const manager = TranscodeQueueManager.getInstance();
    await expect(manager.start()).resolves.not.toThrow();
  });

  it('start loads pending jobs and processes them', async () => {
    mockGetPendingTranscodeJobs.mockResolvedValue(['/a.mp4']);
    const manager = TranscodeQueueManager.getInstance();
    await manager.start();
    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/a.mp4',
        'done',
        null,
      ),
    );
  });

  it('enqueue adds job to DB and processes it successfully', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await manager.enqueue('/video.mp4');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/video.mp4',
        'done',
        null,
      ),
    );
    expect(mockAddTranscodeJob).toHaveBeenCalledWith('/video.mp4');
    expect(mockGenerateSessionId).toHaveBeenCalledWith('/video.mp4');
    expect(mockPinSession).toHaveBeenCalledWith('sess-abc');
  });

  it('enqueue marks job as failed if HLS throws', async () => {
    mockEnsureSessionUnthrottled.mockRejectedValueOnce(new Error('HLS error'));
    const manager = TranscodeQueueManager.getInstance();
    await manager.enqueue('/fail.mp4');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/fail.mp4',
        'failed',
        'HLS error',
      ),
    );
  });

  it('unpins the session after a job completes successfully (BUG 5)', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await manager.enqueue('/video.mp4');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/video.mp4',
        'done',
        null,
      ),
    );

    // The session must be unpinned so periodic idle cleanup can evict the
    // finished session and delete its on-disk output directory.
    expect(mockPinSession).toHaveBeenCalledWith('sess-abc');
    expect(mockUnpinSession).toHaveBeenCalledWith('sess-abc');
  });

  it('unpins the session even when the job fails (BUG 5)', async () => {
    mockEnsureSessionUnthrottled.mockRejectedValueOnce(new Error('HLS error'));
    const manager = TranscodeQueueManager.getInstance();
    await manager.enqueue('/fail.mp4');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/fail.mp4',
        'failed',
        'HLS error',
      ),
    );

    expect(mockUnpinSession).toHaveBeenCalledWith('sess-abc');
  });

  it('cancel skips processing of the job', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await manager.cancel('/skip.mp4');
    // Manually add the cancelled path to queue via internal scheduleJob pattern
    // enqueue would first do addTranscodeJob then scheduleJob
    // But we cancelled beforehand. Add again to trigger the check.
    await manager.enqueue('/skip.mp4');

    // Wait a tick - process job should skip HLS since path was cancelled
    await new Promise((r) => setTimeout(r, 20));
    // HLS should NOT be called since it was cancelled
    expect(mockEnsureSessionUnthrottled).not.toHaveBeenCalled();
  });
});
