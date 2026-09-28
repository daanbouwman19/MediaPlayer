import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MediaAnalyzer } from '../../../src/core/media/analysis/media-analyzer';

const { mockSpawn, mockGetStreams } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockGetStreams: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));
vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));
vi.mock('../../../src/infrastructure/ffmpeg-utils', () => ({
  getFFmpegStreams: mockGetStreams,
  getInputSafetyArgs: () => ['-protocol_whitelist', 'file'],
}));
vi.mock('../../../src/core/media/media-source', () => ({
  createMediaSource: (filePath: string) => ({
    getFFmpegInput: async () => filePath,
  }),
}));
vi.mock('../../../src/core/media/file-identity', () => ({
  getFileIdentity: async () => '1-1',
}));

function createFakeProcess(args: string[]) {
  const proc = new EventEmitter() as any;
  proc.args = args;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe('MediaAnalyzer Robustness', () => {
  let analyzer: MediaAnalyzer;
  let cacheDir: string;
  let proc: any;

  const waitForSpawn = () =>
    vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

  beforeEach(() => {
    vi.clearAllMocks();
    MediaAnalyzer.resetInstance();
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heatmap-robust-'));
    analyzer = MediaAnalyzer.getInstance();
    analyzer.setCacheDir(cacheDir);
    process.env.DISABLE_HEATMAPS = 'false';
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      proc = createFakeProcess(args);
      return proc;
    });
  });

  afterEach(() => {
    MediaAnalyzer.resetInstance();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('should handle missing audio stream gracefully', async () => {
    mockGetStreams.mockResolvedValue({ hasVideo: true, hasAudio: false });

    const promise = analyzer.generateHeatmap('video_only.mp4', 1);
    await waitForSpawn();
    expect(proc.args).not.toContain('[a]');

    proc.stdout.emit(
      'data',
      Buffer.from(
        'frame:0 pts:0 pts_time:0\nlavfi.signalstats.YDIF=0\nframe:1 pts:1 pts_time:1\nlavfi.signalstats.YDIF=10\n',
      ),
    );
    proc.emit('close', 0);

    const result = await promise;
    expect(result.points).toBe(1);
    expect(result.motion[0]).toBe(10);
    expect(result.audio[0]).toBe(-90);
  });

  it('should handle missing video stream gracefully', async () => {
    mockGetStreams.mockResolvedValue({ hasVideo: false, hasAudio: true });

    const promise = analyzer.generateHeatmap('audio_only.mp3', 1);
    await waitForSpawn();
    expect(proc.args).not.toContain('[v]');

    proc.stderr.emit(
      'data',
      Buffer.from(
        '[Parsed_ametadata_2 @ 0x1] lavfi.astats.Overall.RMS_level=-20\n',
      ),
    );
    proc.emit('close', 0);

    const result = await promise;
    expect(result.points).toBe(1);
    expect(result.audio[0]).toBe(-20);
    expect(result.motion[0]).toBe(0);
  });

  it('should fail if BOTH streams are missing', async () => {
    mockGetStreams.mockResolvedValue({ hasVideo: false, hasAudio: false });

    await expect(analyzer.generateHeatmap('empty.file', 10)).rejects.toThrow(
      'No video or audio streams found',
    );
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('should ignore unparsable metadata values', async () => {
    mockGetStreams.mockResolvedValue({ hasVideo: true, hasAudio: true });

    const promise = analyzer.generateHeatmap('garbled.mp4', 1);
    await waitForSpawn();
    proc.stdout.emit(
      'data',
      Buffer.from(
        'lavfi.signalstats.YDIF=5\nframe:0 pts:0 pts_time:0\nlavfi.signalstats.YDIF=nan\nframe:1 pts:1 pts_time:1\nlavfi.signalstats.YDIF=7\n',
      ),
    );
    proc.stderr.emit(
      'data',
      Buffer.from(
        '[x] lavfi.astats.Overall.RMS_level=nan\n[x] lavfi.astats.Overall.RMS_level=-inf\n[x] lavfi.astats.Overall.RMS_level=-150\n',
      ),
    );
    proc.emit('close', 0);

    const result = await promise;
    expect(result.motion).toEqual([0]);
    expect(result.audio).toEqual([-90]);
    expect(result.audio.every(Number.isFinite)).toBe(true);
  });
});
