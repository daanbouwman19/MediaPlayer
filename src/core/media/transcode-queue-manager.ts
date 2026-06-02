import PQueue from 'p-queue';
import {
  addTranscodeJob,
  updateTranscodeJobStatus,
  getPendingTranscodeJobs,
} from '../database/database.ts';
import { HlsManager, HlsSessionStatus } from './hls-manager.ts';
import { generateSessionId } from './hls-handler.ts';

export class TranscodeQueueManager {
  private static instance: TranscodeQueueManager | null = null;
  private queue = new PQueue({ concurrency: 2 });
  private cancelled = new Set<string>();

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
      TranscodeQueueManager.instance = null;
    }
  }

  async start(): Promise<void> {
    const paths = (await getPendingTranscodeJobs()) ?? [];
    for (const p of paths) {
      this.scheduleJob(p);
    }
  }

  async enqueue(filePath: string): Promise<void> {
    await addTranscodeJob(filePath);
    this.scheduleJob(filePath);
  }

  async cancel(filePath: string): Promise<void> {
    this.cancelled.add(filePath);
    const sessionId = await generateSessionId(filePath);
    await HlsManager.getInstance().stopSession(sessionId);
  }

  private scheduleJob(filePath: string): void {
    this.queue.add(() => this.processJob(filePath));
  }

  private async processJob(filePath: string): Promise<void> {
    if (this.cancelled.has(filePath)) {
      this.cancelled.delete(filePath);
      return;
    }
    try {
      await updateTranscodeJobStatus(filePath, 'processing', null);
      const sessionId = await generateSessionId(filePath);
      // Pin before starting so the exit handler marks it COMPLETE, not STOPPED
      HlsManager.getInstance().pinSession(sessionId);
      await HlsManager.getInstance().ensureSessionUnthrottled(
        sessionId,
        filePath,
      );
      // Wait for FFmpeg to actually finish (not just playlist ready)
      const finalStatus =
        await HlsManager.getInstance().waitForSession(sessionId);
      if (this.cancelled.has(filePath)) {
        this.cancelled.delete(filePath);
        return; // DB row already removed by deleteTranscodeJob in the cancel handler
      }
      if (finalStatus === HlsSessionStatus.ERROR) {
        throw new Error('Transcoding failed');
      }
      await updateTranscodeJobStatus(filePath, 'done', null);
    } catch (err) {
      await updateTranscodeJobStatus(
        filePath,
        'failed',
        (err as Error).message,
      );
    }
  }
}
