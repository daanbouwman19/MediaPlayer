import path from 'path';
import PQueue from 'p-queue';
import {
  addTranscodeJob,
  updateTranscodeJobStatus,
  getPendingTranscodeJobs,
  deleteTranscodeJob,
} from '../database/database.ts';
import { HlsManager, HlsSessionStatus } from './hls-manager.ts';
import { generateSessionId } from './hls-handler.ts';
import { SUPPORTED_VIDEO_EXTENSIONS_SET } from './constants.ts';
import { isDrivePath } from './media-utils.ts';

/**
 * Only videos can be pre-transcoded. Drive paths carry no file name (the
 * renderer filters those by name), so they are accepted here.
 */
function isTranscodableVideo(filePath: string): boolean {
  if (isDrivePath(filePath)) return true;
  return SUPPORTED_VIDEO_EXTENSIONS_SET.has(
    path.extname(filePath).toLowerCase(),
  );
}

export class TranscodeQueueManager {
  private static instance: TranscodeQueueManager | null = null;
  private queue = new PQueue({ concurrency: 2 });
  private cancelled = new Set<string>();
  private queued = new Set<string>();
  /** Queued again while a cancelled run was still winding down. */
  private requeue = new Set<string>();
  /** Set by stop(): shutdown in progress, no further jobs run. */
  private stopped = false;

  private constructor() {}

  static getInstance(): TranscodeQueueManager {
    if (!TranscodeQueueManager.instance) {
      TranscodeQueueManager.instance = new TranscodeQueueManager();
    }
    return TranscodeQueueManager.instance;
  }

  static resetInstance(): void {
    if (TranscodeQueueManager.instance) {
      TranscodeQueueManager.instance.queue.clear();
      TranscodeQueueManager.instance.cancelled.clear();
      TranscodeQueueManager.instance.queued.clear();
      TranscodeQueueManager.instance.requeue.clear();
      TranscodeQueueManager.instance = null;
    }
  }

  /**
   * Starts background transcoding: first cleans the HLS cache (partial output
   * from the last run must not be mistaken for a finished job), then resumes
   * the jobs that were pending or processing.
   */
  async start(): Promise<void> {
    await HlsManager.getInstance().init();
    const paths = (await getPendingTranscodeJobs()) ?? [];
    for (const p of paths) {
      if (isTranscodableVideo(p)) {
        this.scheduleJob(p);
      } else {
        // Queued by older versions, which accepted images.
        await deleteTranscodeJob(p);
      }
    }
  }

  /**
   * Stops scheduling jobs for shutdown. Unfinished jobs keep their DB row and
   * resume on the next start().
   */
  stop(): void {
    this.stopped = true;
    this.queue.clear();
  }

  /** Queues a pre-transcode. Returns false (and does nothing) for non-videos. */
  async enqueue(filePath: string): Promise<boolean> {
    if (!isTranscodableVideo(filePath)) {
      console.warn('[TranscodeQueue] Skipping non-video file: %s', filePath);
      return false;
    }
    if (this.queued.has(filePath) && this.cancelled.has(filePath)) {
      // The cancelled run has not finished yet and must still see its
      // cancel; this request runs once it has.
      this.requeue.add(filePath);
    } else {
      // A fresh request overrides an earlier cancel of the same path.
      this.cancelled.delete(filePath);
    }
    await addTranscodeJob(filePath);
    this.scheduleJob(filePath);
    return true;
  }

  /** Cancels a queued or running job and deletes its HLS output. */
  async cancel(filePath: string): Promise<void> {
    // Only flag jobs that will still look at the flag; a stale flag would
    // turn the next enqueue of this path into a silent no-op.
    if (this.queued.has(filePath)) {
      this.cancelled.add(filePath);
    }
    // Also drops a re-queue that is waiting for the cancelled run to end.
    this.requeue.delete(filePath);
    const sessionId = await generateSessionId(filePath);
    await HlsManager.getInstance().stopSession(sessionId);
  }

  private scheduleJob(filePath: string): void {
    // Dedup: a path already queued or processing would otherwise get a
    // second processJob run (DB churn + wasted queue slot).
    if (this.queued.has(filePath)) return;
    this.queued.add(filePath);
    void this.queue.add(() =>
      this.processJob(filePath)
        .catch((err: unknown) => {
          console.error('[TranscodeQueue] Job failed for %s:', filePath, err);
        })
        .finally(() => {
          this.queued.delete(filePath);
          this.cancelled.delete(filePath);
          if (this.requeue.delete(filePath)) {
            this.scheduleJob(filePath);
          }
        }),
    );
  }

  /**
   * Aborted jobs leave the DB alone: the cancel handler deletes the row, and
   * at shutdown the row stays 'processing' so the job resumes on restart.
   */
  private isAborted(filePath: string): boolean {
    return this.stopped || this.cancelled.has(filePath);
  }

  private async processJob(filePath: string): Promise<void> {
    if (this.isAborted(filePath)) return;
    // Compute the session id up front so it is in scope for the finally block
    // that unpins the session regardless of how the job terminates.
    const sessionId = await generateSessionId(filePath);
    const hls = HlsManager.getInstance();
    try {
      await updateTranscodeJobStatus(filePath, 'processing', null);
      if (this.isAborted(filePath)) return;
      // Pinned: keeps transcoding without a viewer, exempt from idle eviction.
      // From here on a cancel finds the session (it is created synchronously)
      // and stops it.
      hls.pinSession(sessionId);
      await hls.ensureSessionUnthrottled(sessionId, filePath);
      // Wait for FFmpeg to actually finish (not just playlist ready). This
      // also settles when the session is stopped or cancelled.
      const finalStatus = await hls.waitForSession(sessionId);
      if (this.isAborted(filePath)) return;
      if (finalStatus === HlsSessionStatus.ERROR) {
        throw new Error('Transcoding failed');
      }
      if (finalStatus === HlsSessionStatus.STOPPED) {
        throw new Error('Transcoding was stopped');
      }
      // Keep the finished output on disk so playback (also after a restart)
      // reuses it instead of transcoding again.
      // retainSession awaits a source probe; shutdown (or a cancel) can evict
      // the session meanwhile, deleting its output. Never record 'done' then.
      const kept = await hls.retainSession(sessionId, filePath);
      if (this.isAborted(filePath)) return;
      if (!kept) {
        throw new Error(
          'Transcoded output was removed before it could be kept',
        );
      }
      await updateTranscodeJobStatus(filePath, 'done', null);
    } catch (err) {
      if (this.isAborted(filePath)) return;
      await updateTranscodeJobStatus(
        filePath,
        'failed',
        (err as Error).message,
      );
    } finally {
      // Unpin now that the job has reached a terminal state. A retained
      // session is evicted from memory later but keeps its output on disk.
      hls.unpinSession(sessionId);
    }
  }
}

/**
 * Stops background transcoding and every HLS ffmpeg process for shutdown
 * (non-detached ffmpeg children would otherwise outlive the app on POSIX).
 */
export async function shutdownTranscoding(): Promise<void> {
  TranscodeQueueManager.getInstance().stop();
  await HlsManager.getInstance().stopAll();
}
