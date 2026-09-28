// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

const {
  mockAddTranscodeJob,
  mockUpdateTranscodeJobStatus,
  mockGetPendingTranscodeJobs,
  mockDeleteTranscodeJob,
  mockEnsureSessionUnthrottled,
  mockPinSession,
  mockUnpinSession,
  mockWaitForSession,
  mockStopSession,
  mockRetainSession,
  mockInit,
  mockStopAll,
  mockGenerateSessionId,
} = vi.hoisted(() => ({
  mockAddTranscodeJob: vi.fn().mockResolvedValue(undefined),
  mockUpdateTranscodeJobStatus: vi.fn().mockResolvedValue(undefined),
  mockGetPendingTranscodeJobs: vi.fn().mockResolvedValue([]),
  mockDeleteTranscodeJob: vi.fn().mockResolvedValue(undefined),
  mockEnsureSessionUnthrottled: vi.fn().mockResolvedValue('/hls/session.m3u8'),
  mockPinSession: vi.fn(),
  mockUnpinSession: vi.fn(),
  mockWaitForSession: vi.fn().mockResolvedValue('complete'),
  mockStopSession: vi.fn().mockResolvedValue(undefined),
  mockRetainSession: vi.fn().mockResolvedValue(true),
  mockInit: vi.fn().mockResolvedValue(undefined),
  mockStopAll: vi.fn().mockResolvedValue(undefined),
  mockGenerateSessionId: vi.fn().mockResolvedValue('sess-abc'),
}));

vi.mock('../../src/core/database/database.ts', () => ({
  addTranscodeJob: mockAddTranscodeJob,
  updateTranscodeJobStatus: mockUpdateTranscodeJobStatus,
  getPendingTranscodeJobs: mockGetPendingTranscodeJobs,
  deleteTranscodeJob: mockDeleteTranscodeJob,
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
      retainSession: mockRetainSession,
      init: mockInit,
      stopAll: mockStopAll,
    })),
  },
}));

vi.mock('../../src/core/media/hls-handler.ts', () => ({
  generateSessionId: mockGenerateSessionId,
}));

import {
  TranscodeQueueManager,
  shutdownTranscoding,
} from '../../src/core/media/transcode-queue-manager.ts';

describe('TranscodeQueueManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    TranscodeQueueManager.resetInstance();
    mockGetPendingTranscodeJobs.mockResolvedValue([]);
    mockEnsureSessionUnthrottled.mockResolvedValue('/hls/session.m3u8');
    mockWaitForSession.mockResolvedValue('complete');
    mockStopSession.mockResolvedValue(undefined);
    mockRetainSession.mockResolvedValue(true);
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

  it('start cleans the HLS cache before resuming jobs (F26)', async () => {
    const order: string[] = [];
    mockInit.mockImplementationOnce(async () => {
      order.push('init');
    });
    mockGetPendingTranscodeJobs.mockImplementationOnce(async () => {
      order.push('pending');
      return [];
    });

    await TranscodeQueueManager.getInstance().start();

    expect(order).toEqual(['init', 'pending']);
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

  it('start drops pending image jobs queued by older versions (F160)', async () => {
    mockGetPendingTranscodeJobs.mockResolvedValue(['/photo.jpg', '/a.mkv']);
    await TranscodeQueueManager.getInstance().start();

    expect(mockDeleteTranscodeJob).toHaveBeenCalledWith('/photo.jpg');
    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/a.mkv',
        'done',
        null,
      ),
    );
    expect(mockEnsureSessionUnthrottled).toHaveBeenCalledTimes(1);
  });

  it('enqueue adds job to DB and processes it successfully', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await expect(manager.enqueue('/video.mp4')).resolves.toBe(true);

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

  it('enqueue refuses images and other non-videos (F160)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = TranscodeQueueManager.getInstance();

    await expect(manager.enqueue('/photos/IMG_1.JPG')).resolves.toBe(false);
    await expect(manager.enqueue('/notes.txt')).resolves.toBe(false);

    expect(mockAddTranscodeJob).not.toHaveBeenCalled();
    expect(mockEnsureSessionUnthrottled).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('enqueue accepts Drive paths, which carry no file name', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await expect(manager.enqueue('gdrive://abc123')).resolves.toBe(true);
    expect(mockAddTranscodeJob).toHaveBeenCalledWith('gdrive://abc123');
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

  it('marks the job failed when ffmpeg fails (including external kills, F114)', async () => {
    mockWaitForSession.mockResolvedValueOnce('error');
    await TranscodeQueueManager.getInstance().enqueue('/killed.mkv');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/killed.mkv',
        'failed',
        'Transcoding failed',
      ),
    );
    expect(mockRetainSession).not.toHaveBeenCalled();
  });

  it('marks the job failed when its session is stopped by someone else', async () => {
    mockWaitForSession.mockResolvedValueOnce('stopped');
    await TranscodeQueueManager.getInstance().enqueue('/stopped.mkv');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/stopped.mkv',
        'failed',
        'Transcoding was stopped',
      ),
    );
  });

  it('retains the output and then unpins after a successful job (F25)', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await manager.enqueue('/video.mp4');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/video.mp4',
        'done',
        null,
      ),
    );

    expect(mockPinSession).toHaveBeenCalledWith('sess-abc');
    expect(mockRetainSession).toHaveBeenCalledWith('sess-abc', '/video.mp4');
    expect(mockUnpinSession).toHaveBeenCalledWith('sess-abc');
    expect(mockRetainSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockUnpinSession.mock.invocationCallOrder[0]!,
    );
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

  it('deduplicates enqueue of the same path while it is queued', async () => {
    let releaseWait!: (v: string) => void;
    mockWaitForSession.mockImplementation(
      () => new Promise<string>((resolve) => (releaseWait = resolve)),
    );
    const manager = TranscodeQueueManager.getInstance();

    await manager.enqueue('/dup.mp4');
    await manager.enqueue('/dup.mp4');
    // Let the first processJob start and block on waitForSession
    await vi.waitFor(() => expect(mockPinSession).toHaveBeenCalledTimes(1));

    releaseWait('complete');
    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/dup.mp4',
        'done',
        null,
      ),
    );
    // Second enqueue was skipped — only one job ran
    expect(mockPinSession).toHaveBeenCalledTimes(1);

    // After completion the path can be enqueued again
    mockWaitForSession.mockResolvedValue('complete');
    await manager.enqueue('/dup.mp4');
    await vi.waitFor(() => expect(mockPinSession).toHaveBeenCalledTimes(2));
  });

  it('cancelling a finished job does not swallow the next enqueue (F24)', async () => {
    const manager = TranscodeQueueManager.getInstance();
    await manager.cancel('/done.mp4'); // "Clear HLS" on a done/failed job
    expect(mockStopSession).toHaveBeenCalledWith('sess-abc');

    await manager.enqueue('/done.mp4');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/done.mp4',
        'done',
        null,
      ),
    );
    expect(mockEnsureSessionUnthrottled).toHaveBeenCalledTimes(1);
  });

  it('cancelling a running job ends it without touching the DB row (F23)', async () => {
    let settle!: (status: string) => void;
    mockWaitForSession.mockImplementationOnce(
      () => new Promise<string>((resolve) => (settle = resolve)),
    );
    // stopSession settles the waiter with STOPPED, like HlsManager does
    mockStopSession.mockImplementationOnce(async () => settle('stopped'));
    const manager = TranscodeQueueManager.getInstance();
    await manager.enqueue('/running.mp4');
    await vi.waitFor(() => expect(mockWaitForSession).toHaveBeenCalled());

    await manager.cancel('/running.mp4');

    await vi.waitFor(() => expect(mockUnpinSession).toHaveBeenCalled());
    expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledTimes(1); // processing
    // The slot and the dedup entry are free again
    await manager.enqueue('/running.mp4');
    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/running.mp4',
        'done',
        null,
      ),
    );
  });

  describe('queued again while the cancelled run winds down (F24)', () => {
    /** The first start of a session hangs until `failStart` is called. */
    function hangFirstStart() {
      let failStart!: (err: Error) => void;
      mockEnsureSessionUnthrottled.mockImplementationOnce(
        () => new Promise<string>((_, reject) => (failStart = reject)),
      );
      return (err: Error) => failStart(err);
    }

    it('runs the new request once the cancelled run has ended', async () => {
      const failStart = hangFirstStart();
      const manager = TranscodeQueueManager.getInstance();
      await manager.enqueue('/again.mp4');
      await vi.waitFor(() =>
        expect(mockEnsureSessionUnthrottled).toHaveBeenCalled(),
      );

      await manager.cancel('/again.mp4');
      await manager.enqueue('/again.mp4');
      // Only now does the cancelled run see that its session was stopped
      failStart(new Error('HLS session was stopped'));

      await vi.waitFor(() =>
        expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
          '/again.mp4',
          'done',
          null,
        ),
      );
      expect(mockUpdateTranscodeJobStatus).not.toHaveBeenCalledWith(
        '/again.mp4',
        'failed',
        expect.anything(),
      );
      expect(mockEnsureSessionUnthrottled).toHaveBeenCalledTimes(2);
    });

    it('a second cancel also drops the pending re-queue', async () => {
      const failStart = hangFirstStart();
      const manager = TranscodeQueueManager.getInstance();
      await manager.enqueue('/twice.mp4');
      await vi.waitFor(() =>
        expect(mockEnsureSessionUnthrottled).toHaveBeenCalled(),
      );

      await manager.cancel('/twice.mp4');
      await manager.enqueue('/twice.mp4');
      await manager.cancel('/twice.mp4');
      failStart(new Error('HLS session was stopped'));

      await vi.waitFor(() => expect(mockUnpinSession).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 10));
      expect(mockEnsureSessionUnthrottled).toHaveBeenCalledTimes(1);
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledTimes(1); // processing
    });
  });

  it('a job cancelled while queued is skipped', async () => {
    const release: ((v: string) => void)[] = [];
    mockWaitForSession.mockImplementation(
      () => new Promise<string>((resolve) => release.push(resolve)),
    );
    const manager = TranscodeQueueManager.getInstance();
    // Fill both queue slots so the third job waits
    await manager.enqueue('/one.mp4');
    await manager.enqueue('/two.mp4');
    await manager.enqueue('/three.mp4');
    await vi.waitFor(() => expect(release).toHaveLength(2));

    await manager.cancel('/three.mp4');
    for (const resolve of release) resolve('complete');

    await vi.waitFor(() =>
      expect(mockUpdateTranscodeJobStatus).toHaveBeenCalledWith(
        '/one.mp4',
        'done',
        null,
      ),
    );
    expect(mockUpdateTranscodeJobStatus).not.toHaveBeenCalledWith(
      '/three.mp4',
      expect.anything(),
      expect.anything(),
    );
  });

  it('a cancel during the processing update skips the transcode', async () => {
    const manager = TranscodeQueueManager.getInstance();
    mockUpdateTranscodeJobStatus.mockImplementationOnce(async () => {
      await manager.cancel('/raced.mp4');
    });

    await manager.enqueue('/raced.mp4');

    await vi.waitFor(() => expect(mockStopSession).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockEnsureSessionUnthrottled).not.toHaveBeenCalled();
  });

  it('logs unexpected job errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateSessionId.mockRejectedValueOnce(new Error('hash failed'));

    await TranscodeQueueManager.getInstance().enqueue('/broken.mp4');

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[TranscodeQueue] Job failed for %s:',
        '/broken.mp4',
        expect.any(Error),
      ),
    );
    error.mockRestore();
  });

  describe('shutdown (F26)', () => {
    it('leaves an interrupted job for the next start', async () => {
      let settle!: (status: string) => void;
      mockWaitForSession.mockImplementationOnce(
        () => new Promise<string>((resolve) => (settle = resolve)),
      );
      const manager = TranscodeQueueManager.getInstance();
      await manager.enqueue('/long.mkv');
      await manager.enqueue('/next.mkv');
      await manager.enqueue('/later.mkv');
      await vi.waitFor(() => expect(mockWaitForSession).toHaveBeenCalled());

      manager.stop();
      settle('stopped');

      await vi.waitFor(() =>
        expect(mockUnpinSession).toHaveBeenCalledWith('sess-abc'),
      );
      await new Promise((r) => setTimeout(r, 10));
      // Not marked failed: the row stays 'processing' and resumes on start()
      expect(mockUpdateTranscodeJobStatus).not.toHaveBeenCalledWith(
        '/long.mkv',
        'failed',
        expect.anything(),
      );
      // Jobs still waiting in the queue never start
      expect(mockUpdateTranscodeJobStatus).not.toHaveBeenCalledWith(
        '/later.mkv',
        expect.anything(),
        expect.anything(),
      );
    });

    it('a job failing because of the shutdown is not marked failed', async () => {
      const manager = TranscodeQueueManager.getInstance();
      mockEnsureSessionUnthrottled.mockImplementationOnce(async () => {
        manager.stop();
        throw new Error('HlsManager: shutting down');
      });

      await manager.enqueue('/late.mkv');

      await vi.waitFor(() => expect(mockUnpinSession).toHaveBeenCalled());
      expect(mockUpdateTranscodeJobStatus).not.toHaveBeenCalledWith(
        '/late.mkv',
        'failed',
        expect.anything(),
      );
    });

    it('shutdownTranscoding stops the queue and every HLS session', async () => {
      await shutdownTranscoding();
      expect(mockStopAll).toHaveBeenCalled();

      await TranscodeQueueManager.getInstance().enqueue('/after.mkv');
      await new Promise((r) => setTimeout(r, 10));
      expect(mockEnsureSessionUnthrottled).not.toHaveBeenCalled();
    });
  });
});
