import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MediaAnalyzer,
  HeatmapData,
} from '../../../src/core/analysis/media-analyzer';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { PassThrough } from 'stream';

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

// Import them for the test
import { getFFmpegStreams } from '../../../src/core/utils/ffmpeg-utils';
import { createMediaSource } from '../../../src/core/media-source';

describe('MediaAnalyzer', () => {
  let analyzer: MediaAnalyzer;

  beforeEach(() => {
    vi.resetAllMocks();
    MediaAnalyzer.resetInstance();
    analyzer = MediaAnalyzer.getInstance();
    analyzer.setCacheDir('/tmp/cache');

    // Default mock behavior
    vi.mocked(getFFmpegStreams).mockResolvedValue({
      hasVideo: true,
      hasAudio: true,
    });
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

  it('should return cached data if available', async () => {
    const mockData: HeatmapData = {
      audio: [0.5],
      motion: [10],
      points: 1,
    };
    (fs.readFile as any).mockResolvedValue(JSON.stringify(mockData));

    const result = await analyzer.generateHeatmap('test.mp4', 1);

    expect(result).toEqual(mockData);
    expect(fs.readFile).toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('should run ffmpeg and parse output if cache misses', async () => {
    (fs.readFile as any).mockRejectedValue(new Error('ENOENT'));
    const mockProcess = setupMockSpawn();

    const promise = analyzer.generateHeatmap('test.mp4', 1);

    // Wait for async setup
    await new Promise((resolve) => setTimeout(resolve, 50));

    mockProcess.stdout.write('lavfi.signalstats.YDIF=10.5\n');
    mockProcess.stdout.write('lavfi.astats.Overall.RMS_level=-20.0\n');
    mockProcess.stdout.end();

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockProcess.emit('close', 0);

    const result = await promise;

    expect(spawn).toHaveBeenCalled();
    expect(result.points).toBe(1);
    expect(result.motion[0]).toBe(10.5);
    expect(result.audio[0]).toBe(-20);
  });

  it('should handle ffmpeg errors', async () => {
    (fs.readFile as any).mockRejectedValue(new Error('ENOENT'));
    const mockProcess = setupMockSpawn();

    const promise = analyzer.generateHeatmap('error.mp4', 10);
    await new Promise((resolve) => setTimeout(resolve, 50));

    mockProcess.emit('close', 1);

    await expect(promise).rejects.toThrow(/FFmpeg process exited with code/);
  });

  it('should throw error if ffmpeg is not found', async () => {
    vi.resetModules();
    vi.doMock('ffmpeg-static', () => ({ default: null }));

    const { MediaAnalyzer: ReImportedAnalyzer } =
      await import('../../../src/core/analysis/media-analyzer');
    const instance = ReImportedAnalyzer.getInstance();

    await expect(instance.generateHeatmap('file', 10)).rejects.toThrow(
      'FFmpeg not found',
    );
  });

  it('should handle resampling correctly', async () => {
    (fs.readFile as any).mockRejectedValue(new Error('No cache'));
    const mockProcess = setupMockSpawn();

    const promise = analyzer.generateHeatmap('small.mp4', 2);
    await new Promise((resolve) => setTimeout(resolve, 50));

    mockProcess.stdout.write('lavfi.signalstats.YDIF=10\n');
    mockProcess.stdout.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
    mockProcess.emit('close', 0);

    const result = await promise;
    expect(result.points).toBe(2);
    expect(result.motion).toEqual([10, 10]);
  });

  describe('getProgress', () => {
    it('returns progress when job is active', async () => {
      (fs.readFile as any).mockRejectedValue(new Error('ENOENT'));
      const mockProcess = setupMockSpawn();

      const promise = analyzer.generateHeatmap('test.mp4', 10);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit duration
      mockProcess.stderr.write('Duration: 00:10:00.00\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Emit time
      mockProcess.stderr.write('time=00:05:00.00\n');
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(analyzer.getProgress('test.mp4')).toBe(50);

      mockProcess.stdout.end();
      mockProcess.stderr.end();
      mockProcess.emit('close', 0);
      await promise;
    });
  });

  describe('Duplicate job handling', () => {
    it('joins existing job instead of creating duplicate', async () => {
      (fs.readFile as any).mockRejectedValue(new Error('ENOENT'));
      const mockProcess = setupMockSpawn();

      const promise1 = analyzer.generateHeatmap('same-file.mp4', 10);
      const promise2 = analyzer.generateHeatmap('same-file.mp4', 10);

      await new Promise((resolve) => setTimeout(resolve, 50));

      mockProcess.stdout.end();
      mockProcess.emit('close', 0);

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual(result2);
      expect(spawn).toHaveBeenCalledTimes(1);
    });
  });
});
