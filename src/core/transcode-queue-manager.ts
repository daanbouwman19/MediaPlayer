import PQueue from 'p-queue';
import {
  addTranscodeJob,
  updateTranscodeJobStatus,
  getPendingTranscodeJobs,
} from './database.ts';
import { HlsManager } from './hls-manager.ts';
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
      await HlsManager.getInstance().ensureSessionUnthrottled(
        sessionId,
        filePath,
      );
      HlsManager.getInstance().pinSession(sessionId);
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
