import { describe, it, expect, vi, beforeEach } from 'vitest';
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

let detectFFmpegCapabilities: any;
let getHardwareCodec: any;
let getHlsTranscodeArgs: any;
let runFFmpeg: any;

describe('FFmpeg Utils Coverage Boost', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../../src/infrastructure/ffmpeg-utils');
    detectFFmpegCapabilities = mod.detectFFmpegCapabilities;
    getHardwareCodec = mod.getHardwareCodec;
    getHlsTranscodeArgs = mod.getHlsTranscodeArgs;
    runFFmpeg = mod.runFFmpeg;
  });

  describe('detectFFmpegCapabilities', () => {
    it('detects various hardware encoders', async () => {
      const mockProcess = createMockProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const promise = detectFFmpegCapabilities('ffmpeg');
      mockProcess.stderr.emit(
        'data',
        'V....L h264_nvenc\nV....L h264_videotoolbox\nV....L h264_vaapi\n',
      );
      mockProcess.emit('exit', 0);

      const caps = await promise;
      expect(caps?.hasNVENC).toBe(true);
      expect(caps?.hasVideoToolbox).toBe(true);
      expect(caps?.hasVAAPI).toBe(true);
    });

    it('returns null on error and logs it', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      mockSpawn.mockImplementation(() => {
        throw new Error('Spawn failed');
      });

      const caps = await detectFFmpegCapabilities('ffmpeg');
      expect(caps).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('getHardwareCodec', () => {
    it('returns libx264 when no capabilities', () => {
      expect(getHardwareCodec(null)).toBe('libx264');
    });

    it('prioritizes nvenc', () => {
      expect(
        getHardwareCodec({
          hasNVENC: true,
          hasVideoToolbox: true,
          hasVAAPI: true,
          supportedVideoCodecs: [],
        }),
      ).toBe('h264_nvenc');
    });

    it('falls back to videotoolbox', () => {
      expect(
        getHardwareCodec({
          hasNVENC: false,
          hasVideoToolbox: true,
          hasVAAPI: true,
          supportedVideoCodecs: [],
        }),
      ).toBe('h264_videotoolbox');
    });

    it('falls back to vaapi', () => {
      expect(
        getHardwareCodec({
          hasNVENC: false,
          hasVideoToolbox: false,
          hasVAAPI: true,
          supportedVideoCodecs: [],
        }),
      ).toBe('h264_vaapi');
    });

    it('falls back to libx264 if none matched', () => {
      expect(
        getHardwareCodec({
          hasNVENC: false,
          hasVideoToolbox: false,
          hasVAAPI: false,
          supportedVideoCodecs: [],
        }),
      ).toBe('libx264');
    });
  });

  describe('getHlsTranscodeArgs', () => {
    it('handles copyAudio and custom hwCodec', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5, {
        copyAudio: true,
        hwCodec: 'h264_nvenc',
      });
      expect(args).toContain('copy');
      expect(args).toContain('h264_nvenc');
      expect(args).not.toContain('-crf'); // CRF only for libx264
    });

    it('handles custom preset and crf', () => {
      const args = getHlsTranscodeArgs('in.mp4', 'seg.ts', 'list.m3u8', 5, {
        preset: 'fast',
        crf: '20',
      });
      expect(args).toContain('fast');
      expect(args).toContain('20');
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
  });
});
