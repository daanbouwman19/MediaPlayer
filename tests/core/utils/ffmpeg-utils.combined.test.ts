// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runFFmpeg,
  getFFmpegDuration,
  getFFmpegStreams,
  getTranscodeArgs,
  getThumbnailArgs,
  parseFFmpegDuration,
  getHlsTranscodeArgs,
} from '../../../src/core/utils/ffmpeg-utils';
import EventEmitter from 'events';

// Mock spawn
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
}));

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 123;
  return proc;
}

describe('FFmpeg Utils Combined Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // From ffmpeg-utils.params.test.ts
  describe('getTranscodeArgs', () => {
    const INPUT_PATH = '/path/to/video.mp4';

    it('returns basic arguments without start time', () => {
      const args = getTranscodeArgs(INPUT_PATH, undefined);

      // Performance flags
      expect(args).toContain('-hide_banner');
      expect(args).toContain('-loglevel');
      expect(args).toContain('error');

      // Core inputs
      expect(args).toContain(INPUT_PATH);
      expect(args).toContain('pipe:1');
      expect(args).toContain('libx264');

      // Verify standardized codec flags
      expect(args).toContain('-c:v');
      expect(args).toContain('-c:a');
      expect(args).not.toContain('-vcodec'); // Legacy flag removed
      expect(args).not.toContain('-acodec'); // Legacy flag removed

      // Ensure no start time arg
      expect(args).not.toContain('-ss');
    });

    it('includes start time for format: 10 (simple seconds)', () => {
      const args = getTranscodeArgs(INPUT_PATH, '10');
      expect(args).toContain('-ss');
      expect(args).toContain('10');
    });

    it('includes start time for format: 10.5 (seconds with decimal)', () => {
      const args = getTranscodeArgs(INPUT_PATH, '10.5');
      expect(args).toContain('-ss');
      expect(args).toContain('10.5');
    });

    it('includes start time for format: 00:10 (MM:SS)', () => {
      const args = getTranscodeArgs(INPUT_PATH, '00:10');
      expect(args).toContain('-ss');
      expect(args).toContain('00:10');
    });

    it('includes start time for format: 00:00:10 (HH:MM:SS)', () => {
      const args = getTranscodeArgs(INPUT_PATH, '00:00:10');
      expect(args).toContain('-ss');
      expect(args).toContain('00:00:10');
    });

    it('includes start time for format: 1:30:05.500 (full timestamp with ms)', () => {
      const args = getTranscodeArgs(INPUT_PATH, '1:30:05.500');
      expect(args).toContain('-ss');
      expect(args).toContain('1:30:05.500');
    });

    it('includes start time for format: 01:00:00 (1 hour)', () => {
      const args = getTranscodeArgs(INPUT_PATH, '01:00:00');
      expect(args).toContain('-ss');
      expect(args).toContain('01:00:00');
    });

    it('throws error for invalid time format: 10;rm -rf (command injection attempt)', () => {
      expect(() => getTranscodeArgs(INPUT_PATH, '10;rm -rf')).toThrow(
        'Invalid start time format',
      );
    });

    it('throws error for invalid time format: invalid (non-numeric)', () => {
      expect(() => getTranscodeArgs(INPUT_PATH, 'invalid')).toThrow(
        'Invalid start time format',
      );
    });

    it('throws error for invalid time format: 10:10:10:10 (too many colons)', () => {
      expect(() => getTranscodeArgs(INPUT_PATH, '10:10:10:10')).toThrow(
        'Invalid start time format',
      );
    });

    it('throws error for invalid time format: -10 (negative number)', () => {
      expect(() => getTranscodeArgs(INPUT_PATH, '-10')).toThrow(
        'Invalid start time format',
      );
    });

    it('throws error for invalid time format:  10  (whitespace)', () => {
      expect(() => getTranscodeArgs(INPUT_PATH, ' 10 ')).toThrow(
        'Invalid start time format',
      );
    });

    it('throws error for invalid time format: 10& (special char)', () => {
      expect(() => getTranscodeArgs(INPUT_PATH, '10&')).toThrow(
        'Invalid start time format',
      );
    });

    it('handles null start time as undefined', () => {
      const args = getTranscodeArgs(INPUT_PATH, null as any);
      expect(args).not.toContain('-ss');
    });
  });

  describe('getHlsTranscodeArgs', () => {
    it('returns correct arguments for HLS transcoding', () => {
      const args = getHlsTranscodeArgs(
        '/path/in.mp4',
        '/path/out_%03d.ts',
        '/path/out.m3u8',
        5,
        {},
      );
      expect(args).toContain('-f');
      expect(args).toContain('hls');
      expect(args).toContain('/path/out.m3u8');
    });
  });

  describe('getThumbnailArgs', () => {
    it('includes performance flags', () => {
      const args = getThumbnailArgs('/in.mp4', '/out.jpg');
      expect(args).toContain('-ss');
      expect(args).toContain('1');
      expect(args).toContain('-frames:v');
      expect(args).toContain('1');
    });
  });

  describe('parseFFmpegDuration', () => {
    it('correctly parses standard duration', () => {
      expect(parseFFmpegDuration('Duration: 00:01:00.00')).toBe(60);
    });

    it('correctly parses duration with no leading zeros', () => {
      expect(parseFFmpegDuration('Duration: 0:1:0.00')).toBe(60);
    });

    it('correctly parses long duration', () => {
      expect(parseFFmpegDuration('Duration: 02:30:15.50')).toBe(9015.5);
    });

    it('correctly parses duration with fractional seconds', () => {
      expect(parseFFmpegDuration('Duration: 00:00:00.50')).toBe(0.5);
    });

    it('correctly parses exact zero duration', () => {
      expect(parseFFmpegDuration('Duration: 00:00:00.00')).toBe(0);
    });

    it('correctly parses large hours', () => {
      expect(parseFFmpegDuration('Duration: 100:00:00.00')).toBe(360000);
    });

    it('correctly parses no fractional seconds', () => {
      expect(parseFFmpegDuration('Duration: 00:00:10')).toBe(10);
    });

    it('correctly parses surrounded by garbage', () => {
      expect(
        parseFFmpegDuration('Input #0, mov... Duration: 00:00:10.00, start: 0'),
      ).toBe(10);
    });

    it('correctly parses invalid format (missing parts)', () => {
      expect(parseFFmpegDuration('Duration: 00:10')).toBe(null);
    });

    it('correctly parses invalid format (letters)', () => {
      expect(parseFFmpegDuration('Duration: aa:bb:cc')).toBe(null);
    });

    it('correctly parses empty string', () => {
      expect(parseFFmpegDuration('')).toBe(null);
    });

    it('correctly parses malformed duration label', () => {
      expect(parseFFmpegDuration('Dur: 00:00:10.00')).toBe(null);
    });
  });

  describe('runFFmpeg', () => {
    it('should throw timeout error if process runs too long', async () => {
      vi.useFakeTimers();
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = runFFmpeg('ffmpeg', [], 1000);
      // Suppress unhandled rejection warning during the wait
      promise.catch(() => {});

      // Advance timers by timeoutMs
      await vi.advanceTimersByTimeAsync(1100);

      await expect(promise).rejects.toThrow('Process timed out after 1000ms');
      expect(mockProcess.kill).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should rethrow generic errors from spawn', async () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      await expect(runFFmpeg('ffmpeg', [])).rejects.toThrow('Spawn failed');
    });

    it('should return result when process completes successfully', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = runFFmpeg('ffmpeg', []);

      // Simulate data on stderr
      mockProcess.stderr.emit('data', Buffer.from('test output'));
      // Simulate exit
      mockProcess.emit('exit', 0, null);

      const result = await promise;
      expect(result).toEqual({ code: 0, stderr: 'test output' });
    });
  });

  describe('getFFmpegDuration', () => {
    it('resolves with duration when ffmpeg provides it', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = getFFmpegDuration('/path/to/video.mp4', 'ffmpeg');

      mockProcess.stderr.emit(
        'data',
        Buffer.from('Duration: 00:01:01.50, start:'),
      );
      mockProcess.emit('exit', 0, null);

      const duration = await promise;
      expect(duration).toBeCloseTo(61.5);
    });

    it('rejects when duration cannot be determined', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = getFFmpegDuration('/path/to/video.mp4', 'ffmpeg');

      mockProcess.stderr.emit('data', Buffer.from('Invalid input'));
      mockProcess.emit('exit', 0, null);

      await expect(promise).rejects.toThrow('Could not determine duration');
    });

    it('rejects when ffmpeg spawn fails (logs error)', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const spawnError = new Error('Spawn failed');
      mockSpawn.mockImplementation(() => {
        throw spawnError;
      });

      await expect(
        getFFmpegDuration('/path/to/video.mp4', 'ffmpeg'),
      ).rejects.toThrow('FFmpeg execution failed');

      expect(consoleSpy).toHaveBeenCalledWith(
        '[Metadata] FFmpeg spawn error:',
        spawnError,
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getFFmpegStreams', () => {
    const INPUT_PATH = '/path/to/video.mp4';

    it('returns true for both when both streams exist', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = getFFmpegStreams(INPUT_PATH, 'ffmpeg');

      mockProcess.stderr.emit(
        'data',
        Buffer.from('Stream #0:0: Video: h264\nStream #0:1: Audio: aac'),
      );
      mockProcess.emit('exit', 0, null);

      const streams = await promise;
      expect(streams).toEqual({ hasVideo: true, hasAudio: true });
    });

    it('returns false for video if missing', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = getFFmpegStreams(INPUT_PATH, 'ffmpeg');

      mockProcess.stderr.emit('data', Buffer.from('Stream #0:0: Audio: aac'));
      mockProcess.emit('exit', 0, null);

      const streams = await promise;
      expect(streams).toEqual({ hasVideo: false, hasAudio: true });
    });

    it('returns false for audio if missing', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = getFFmpegStreams(INPUT_PATH, 'ffmpeg');

      mockProcess.stderr.emit('data', Buffer.from('Stream #0:0: Video: h264'));
      mockProcess.emit('exit', 0, null);

      const streams = await promise;
      expect(streams).toEqual({ hasVideo: true, hasAudio: false });
    });

    it('handles garbage output', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = getFFmpegStreams(INPUT_PATH, 'ffmpeg');

      mockProcess.stderr.emit('data', Buffer.from('Invalid output'));
      mockProcess.emit('exit', 0, null);

      const streams = await promise;
      expect(streams).toEqual({ hasVideo: false, hasAudio: false });
    });
  });
});
