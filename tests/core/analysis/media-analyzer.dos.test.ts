import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MediaAnalyzer } from '../../../src/core/analysis/media-analyzer.ts';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: { spawn },
  };
});
vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));
vi.mock('crypto', () => ({
  default: {
    createHash: () => ({
      update: () => ({
        digest: () => 'mockhash',
      }),
    }),
  },
}));

vi.mock('../../../src/core/utils/ffmpeg-utils.ts', () => ({
  getFFmpegStreams: vi.fn(),
  runFFmpeg: vi.fn(),
}));
vi.mock('../../../src/core/media-source.ts', () => ({
  createMediaSource: vi.fn(),
}));

import { getFFmpegStreams } from '../../../src/core/utils/ffmpeg-utils.ts';
import { createMediaSource } from '../../../src/core/media-source.ts';

describe('MediaAnalyzer DoS Protection', () => {
  let analyzer: MediaAnalyzer;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();

    // Reset singleton
    (MediaAnalyzer as any).instance = null;
    analyzer = MediaAnalyzer.getInstance();
    analyzer.setCacheDir('/tmp/cache');

    // Mock successful stream detection
    (getFFmpegStreams as any).mockResolvedValue({
      hasVideo: true,
      hasAudio: true,
    });
    vi.mocked(createMediaSource).mockImplementation((path: string) => ({
      getFFmpegInput: vi.fn().mockResolvedValue(path),
      getStream: vi.fn(),
      getMimeType: vi.fn(),
      getSize: vi.fn(),
    }));

    // Mock fs.readFile to always fail (cache miss)
    (fs.readFile as any).mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should reject requests when the queue is full', async () => {
    // Mock spawn to return a process that never exits (hangs), simulating slow processing
    (spawn as any).mockImplementation(() => {
      const mockProcess = new EventEmitter();
      (mockProcess as any).stdout = new EventEmitter();
      (mockProcess as any).stderr = new EventEmitter();
      (mockProcess as any).kill = vi.fn();
      return mockProcess;
    });

    const MAX_QUEUE_SIZE = 50;
    const promises: Promise<any>[] = [];

    // Queue MAX_QUEUE_SIZE + 2 items.
    // 1st item (i=0): Starts running immediately. Queue size 0.
    // Items 1..MAX_QUEUE_SIZE (50 items): Queued. Queue size becomes 50.
    // Item MAX_QUEUE_SIZE+1 (i=51): Should be rejected because Queue size is 50.

    for (let i = 0; i < MAX_QUEUE_SIZE + 2; i++) {
      promises.push(
        analyzer.generateHeatmap(`file-${i}.mp4`, 10).catch((e) => e),
      );
    }

    // Wait for microtasks
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => process.nextTick(resolve));
    }

    // Check the last promise
    const lastResult = await promises[promises.length - 1];

    expect(lastResult).toBeInstanceOf(Error);
    expect((lastResult as Error).message).toMatch(/queue full/i);

    // Optional: check that previous promises are pending (mocked timeout)
    // But since we catch error, pending ones stay pending.
  });
});
