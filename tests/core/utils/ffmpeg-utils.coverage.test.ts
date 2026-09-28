import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import EventEmitter from 'events';

// Mock spawn
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

function createMockProcess() {
  const proc = new EventEmitter() as any;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  proc.pid = 123;
  return proc;
}

let getHlsTranscodeArgs: any;
let getInputSafetyArgs: any;
let getTranscodeArgs: any;
let getThumbnailArgs: any;
let getFFmpegStreams: any;
let runFFmpeg: any;

/** Returns the arguments that directly precede the given `-i` input. */
function optionsBeforeInput(args: string[], input: string): string[] {
  const inputIndex = args.findIndex(
    (arg, i) => arg === input && args[i - 1] === '-i',
  );
  return args.slice(0, inputIndex - 1);
}

describe('FFmpeg Utils Coverage Boost', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../../src/infrastructure/ffmpeg-utils');
    getHlsTranscodeArgs = mod.getHlsTranscodeArgs;
    getInputSafetyArgs = mod.getInputSafetyArgs;
    getTranscodeArgs = mod.getTranscodeArgs;
    getThumbnailArgs = mod.getThumbnailArgs;
    getFFmpegStreams = mod.getFFmpegStreams;
    runFFmpeg = mod.runFFmpeg;
  });

  describe('getInputSafetyArgs', () => {
    it('restricts local inputs to the file protocol', () => {
      const args = getInputSafetyArgs('/media/movie.mkv');
      expect(args.slice(0, 2)).toEqual(['-protocol_whitelist', 'file']);
    });

    it('allows only http over tcp for the internal Drive proxy URL', () => {
      const args = getInputSafetyArgs(
        'http://127.0.0.1:1234/stream/abc.mp4?token=x',
      );
      expect(args.slice(0, 2)).toEqual(['-protocol_whitelist', 'http,tcp']);
    });

    it('treats any other scheme as a local path (file protocol only)', () => {
      const args = getInputSafetyArgs('https://example.com/a.mp4');
      expect(args[1]).toBe('file');
    });

    it('allows media demuxers but no playlist/manifest demuxers', () => {
      const args = getInputSafetyArgs('/media/movie.mkv');
      expect(args[2]).toBe('-format_whitelist');
      const demuxers = String(args[3]).split(',');
      expect(demuxers).toEqual(
        expect.arrayContaining(['mov', 'matroska', 'avi', 'image2']),
      );
      for (const unsafe of ['dash', 'hls', 'concat', 'sdp', 'rtsp']) {
        expect(demuxers).not.toContain(unsafe);
      }
    });

    it('is applied to the input of every ffmpeg command', () => {
      const input = '/media/movie.mkv';
      const safety = getInputSafetyArgs(input);
      const commands = [
        getTranscodeArgs(input, '10'),
        getThumbnailArgs(input, '/cache/t.jpg'),
        getHlsTranscodeArgs(input, 'seg-%03d.ts', 'list.m3u8', 6),
      ];
      for (const args of commands) {
        const before = optionsBeforeInput(args, input);
        expect(before.slice(-safety.length)).toEqual(safety);
      }
    });

    it('is applied to the probe run by getFFmpegStreams', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      const promise = getFFmpegStreams('/media/movie.mkv', 'ffmpeg');
      mockProcess.emit('close', 1, null);
      await promise;
      expect(mockSpawn).toHaveBeenCalledWith(
        'ffmpeg',
        [...getInputSafetyArgs('/media/movie.mkv'), '-i', '/media/movie.mkv'],
        { windowsHide: true },
      );
    });
  });

  describe('getFFmpegStreams', () => {
    it('reports the container duration from the probe', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      const promise = getFFmpegStreams('/media/movie.mkv', 'ffmpeg');
      mockProcess.stderr.emit(
        'data',
        '  Duration: 00:01:40.50, start: 0.000000, bitrate: 107 kb/s\n' +
          '  Stream #0:0: Video: h264 (High), yuv420p\n',
      );
      mockProcess.emit('close', 1, null);
      const streams = await promise;
      expect(streams.duration).toBeCloseTo(100.5);
      expect(streams.videoCodec).toBe('h264');
    });

    it('omits a zero or missing duration', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      const promise = getFFmpegStreams('/media/movie.mkv', 'ffmpeg');
      mockProcess.stderr.emit('data', 'Duration: 00:00:00.00\n');
      mockProcess.emit('close', 1, null);
      expect(await promise).not.toHaveProperty('duration');
    });
  });

  describe('getHlsTranscodeArgs', () => {
    it('handles copyAudio with libx264 video', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5, {
        copyAudio: true,
      });
      expect(args).toContain('copy');
      expect(args).toContain('libx264');
      expect(args).toContain('-crf');
    });

    it('skips encoder options when copying video', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5, {
        copyVideo: true,
      });
      expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
      expect(args).not.toContain('-crf');
      expect(args).not.toContain('-preset');
    });

    it('handles custom preset and crf', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5, {
        preset: 'fast',
        crf: '20',
      });
      expect(args).toContain('fast');
      expect(args).toContain('20');
    });

    it('prints progress stats despite -loglevel error', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5);
      expect(args[args.indexOf('-loglevel') + 1]).toBe('error');
      expect(args).toContain('-stats');
    });

    it('writes an EVENT playlist (starts at 0, ENDLIST when finished)', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5);
      expect(args[args.indexOf('-hls_playlist_type') + 1]).toBe('event');
      // Output options must come after the input.
      expect(args.indexOf('-hls_playlist_type')).toBeGreaterThan(
        args.indexOf('-i'),
      );
    });
  });

  describe('runFFmpeg additional branches', () => {
    it('handles proc error when not timed out', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = runFFmpeg('ffmpeg', []);
      mockProcess.emit('error', new Error('Proc error'));

      await expect(promise).rejects.toThrow('Proc error');
    });

    it('spawns without a console window', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      const promise = runFFmpeg('ffmpeg', ['-i', 'x']);
      mockProcess.emit('close', 0, null);
      await promise;
      expect(mockSpawn).toHaveBeenCalledWith('ffmpeg', ['-i', 'x'], {
        windowsHide: true,
      });
    });

    it('waits for stdio to drain: output after exit is not lost', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);
      const promise = runFFmpeg('ffmpeg', []);
      let settled = false;
      void promise.then(() => (settled = true));

      mockProcess.stderr.emit('data', 'Stream #0:0: Video: h264\n');
      mockProcess.emit('exit', 1, null);
      await new Promise((r) => setImmediate(r));
      expect(settled).toBe(false);

      // Buffered stderr can still arrive between 'exit' and 'close'.
      mockProcess.stderr.emit('data', 'Stream #0:1: Audio: aac\n');
      mockProcess.emit('close', 1, null);

      const result = await promise;
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Audio: aac');
    });
  });
});
