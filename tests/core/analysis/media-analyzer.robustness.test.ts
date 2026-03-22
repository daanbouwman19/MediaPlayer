import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaAnalyzer } from '../../../src/core/analysis/media-analyzer';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';

// Mock dependencies
const { mockFs } = vi.hoisted(() => {
  return {
    mockFs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
      access: vi.fn(),
      stat: vi.fn(),
    },
  };
});

vi.mock('fs/promises', () => ({
  default: mockFs,
  readFile: mockFs.readFile,
  writeFile: mockFs.writeFile,
  mkdir: mockFs.mkdir,
  access: mockFs.access,
  stat: mockFs.stat,
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

// Mock using the exact same strings as the source imports
// PLUS the strings as the test imports
vi.mock('../../../src/core/utils/ffmpeg-utils', () => ({
  getFFmpegStreams: vi.fn(),
  runFFmpeg: vi.fn(),
}));
vi.mock('../../../src/core/utils/ffmpeg-utils.ts', () => ({
  getFFmpegStreams: vi.fn(),
  runFFmpeg: vi.fn(),
}));

vi.mock('../../../src/core/media-source', () => ({
  createMediaSource: vi.fn(),
}));
vi.mock('../../../src/core/media-source.ts', () => ({
  createMediaSource: vi.fn(),
}));

import { getFFmpegStreams } from '../../../src/core/utils/ffmpeg-utils';
import { createMediaSource } from '../../../src/core/media-source';

describe('MediaAnalyzer Robustness', () => {
  let analyzer: MediaAnalyzer;

  beforeEach(() => {
    vi.resetAllMocks();
    MediaAnalyzer.resetInstance();
    analyzer = MediaAnalyzer.getInstance();
    analyzer.setCacheDir('/tmp/cache');
    (fs.readFile as any).mockRejectedValue(new Error('ENOENT')); // Cache miss
    vi.mocked(createMediaSource).mockImplementation((path: string) => ({
      getFFmpegInput: vi.fn().mockResolvedValue(path),
      getStream: vi.fn(),
      getMimeType: vi.fn(),
      getSize: vi.fn(),
      getType: () => 'local',
    }));
  });

  const setupMockSpawn = () => {
    const mockProcess = new EventEmitter() as any;
    mockProcess.stdout = new PassThrough();
    mockProcess.stderr = new PassThrough();
    mockProcess.kill = vi.fn();
    (spawn as any).mockReturnValue(mockProcess);
    return mockProcess;
  };

  it('should handle missing audio stream gracefully', async () => {
    vi.mocked(getFFmpegStreams).mockResolvedValue({
      hasVideo: true,
      hasAudio: false,
    });

    const mockProcess = setupMockSpawn();
    const promise = analyzer.generateHeatmap('video_only.mp4', 1);

    await new Promise((resolve) => setTimeout(resolve, 50));

    mockProcess.stdout.write('lavfi.signalstats.YDIF=10\n');
    mockProcess.stdout.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockProcess.emit('close', 0);

    const result = await promise;
    expect(result.points).toBe(1);
    expect(result.motion[0]).toBe(10);
    expect(result.audio[0]).toBe(-90);
  });

  it('should handle missing video stream gracefully', async () => {
    vi.mocked(getFFmpegStreams).mockResolvedValue({
      hasVideo: false,
      hasAudio: true,
    });

    const mockProcess = setupMockSpawn();
    const promise = analyzer.generateHeatmap('audio_only.mp3', 1);

    await new Promise((resolve) => setTimeout(resolve, 50));

    mockProcess.stdout.write('lavfi.astats.Overall.RMS_level=-20\n');
    mockProcess.stdout.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockProcess.emit('close', 0);

    const result = await promise;
    expect(result.points).toBe(1);
    expect(result.audio[0]).toBe(-20);
    expect(result.motion[0]).toBe(0);
  });

  it('should fail if BOTH streams are missing', async () => {
    vi.mocked(getFFmpegStreams).mockResolvedValue({
      hasVideo: false,
      hasAudio: false,
    });

    const promise = analyzer.generateHeatmap('empty.file', 10);
    await expect(promise).rejects.toThrow('No video or audio streams found');
  });

  it('should handle partial output lines correctly', async () => {
    vi.mocked(getFFmpegStreams).mockResolvedValue({
      hasVideo: true,
      hasAudio: true,
    });
    const mockProcess = setupMockSpawn();
    const promise = analyzer.generateHeatmap('partial.mp4', 1);

    await new Promise((resolve) => setTimeout(resolve, 50));

    mockProcess.stdout.write('lavfi.signalstats.YDIF=10\n');
    mockProcess.stdout.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockProcess.emit('close', 0);

    const result = await promise;
    expect(result.points).toBe(1);
    expect(result.motion[0]).toBe(10);
    expect(result.audio[0]).toBe(-90);
  });
});
