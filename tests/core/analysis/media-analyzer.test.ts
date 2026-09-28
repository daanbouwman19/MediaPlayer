import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MediaAnalyzer } from '../../../src/core/media/analysis/media-analyzer';
import {
  HeatmapBusyError,
  isHeatmapBusyError,
} from '../../../src/core/media/analysis/heatmap-errors';

const { mockSpawn, mockGetStreams, mockGetIdentity, mockFFmpegPath } =
  vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockGetStreams: vi.fn(),
    mockGetIdentity: vi.fn(),
    mockFFmpegPath: vi.fn(),
  }));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));
vi.mock('../../../src/infrastructure/ffmpeg-static-path', () => ({
  getFFmpegStaticPath: mockFFmpegPath,
}));
vi.mock('../../../src/infrastructure/ffmpeg-utils', () => ({
  getFFmpegStreams: mockGetStreams,
  getInputSafetyArgs: () => [
    '-protocol_whitelist',
    'file',
    '-format_whitelist',
    'mov,mp4',
  ],
}));
vi.mock('../../../src/core/media/media-source', () => ({
  createMediaSource: (filePath: string) => ({
    getFFmpegInput: async () => filePath,
  }),
}));
vi.mock('../../../src/core/media/file-identity', () => ({
  getFileIdentity: mockGetIdentity,
}));

interface FakeProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  args: string[];
  out(text: string): void;
  err(text: string): void;
}

const processes: FakeProcess[] = [];

function createFakeProcess(args: string[]): FakeProcess {
  const proc = new EventEmitter() as FakeProcess;
  proc.args = args;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn(() => {
    setImmediate(() => proc.emit('close', null));
    return true;
  });
  proc.out = (text) => proc.stdout.emit('data', Buffer.from(text));
  proc.err = (text) => proc.stderr.emit('data', Buffer.from(text));
  return proc;
}

/** Emits FFmpeg-like output: stream info, keyframe YDIF lines and RMS levels. */
function emitAnalysis(
  proc: FakeProcess,
  {
    duration = '00:00:04.00',
    start = '0.000000',
    frames = [
      [0, 0],
      [1, 4],
      [2, 8],
      [3, 2],
    ] as [number, number][],
    rms = ['-20.5', '-10.25'],
    code = 0,
  } = {},
) {
  proc.err(`  Duration: ${duration}, start: ${start}, bitrate: 100 kb/s\n`);
  frames.forEach(([time, ydif], i) => {
    proc.out(`frame:${i}    pts:${time * 1000}     pts_time:${time}\n`);
    proc.out(`lavfi.signalstats.YDIF=${ydif}\n`);
  });
  for (const level of rms) {
    proc.err('[Parsed_ametadata_5 @ 0x1] frame:0    pts:0    pts_time:0\n');
    proc.err(
      `[Parsed_ametadata_5 @ 0x1] lavfi.astats.Overall.RMS_level=${level}\n`,
    );
  }
  proc.emit('close', code);
}

const spawned = async (count: number) => {
  await vi.waitFor(() => expect(processes).toHaveLength(count));
  return processes[count - 1]!;
};

describe('MediaAnalyzer', () => {
  let analyzer: MediaAnalyzer;
  let cacheDir: string;

  const cacheFiles = () => fs.readdirSync(cacheDir).sort();
  const cachePathFor = (filePath: string, identity: string) =>
    path.join(
      cacheDir,
      `heatmap_v2_${crypto
        .createHash('sha256')
        .update(`${filePath}\0${identity}`)
        .digest('hex')}.json`,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    processes.length = 0;
    MediaAnalyzer.resetInstance();
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heatmaps-'));
    analyzer = MediaAnalyzer.getInstance();
    analyzer.setCacheDir(cacheDir);
    process.env.DISABLE_HEATMAPS = 'false';

    mockFFmpegPath.mockReturnValue('/usr/bin/ffmpeg');
    mockGetStreams.mockResolvedValue({ hasVideo: true, hasAudio: true });
    mockGetIdentity.mockResolvedValue('100-1');
    mockSpawn.mockImplementation((_cmd: string, args: string[]) => {
      const proc = createFakeProcess(args);
      processes.push(proc);
      return proc;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    MediaAnalyzer.resetInstance();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('decodes keyframes only, with limited threads, and floors silence', async () => {
    const pending = analyzer.generateHeatmap('/v/movie.mp4', 4);
    const proc = await spawned(1);
    emitAnalysis(proc, { rms: ['-inf', '-inf', '-20', '-10'] });
    const result = await pending;

    const args = proc.args;
    expect(args.indexOf('-skip_frame')).toBeLessThan(args.indexOf('-i'));
    expect(args[args.indexOf('-skip_frame') + 1]).toBe('nokey');
    expect(args[args.indexOf('-threads') + 1]).toBe('2');

    // The input is restricted to safe protocols and demuxers (F79)
    const inputAt = args.indexOf('-i');
    expect(args.slice(inputAt - 4, inputAt + 2)).toEqual([
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'mov,mp4',
      '-i',
      '/v/movie.mp4',
    ]);

    expect(result.points).toBe(4);
    expect(result.motion).toEqual([4, 8, 2, 2]);
    // "-inf" (silence) becomes the floor instead of NaN/null.
    expect(result.audio).toEqual([-90, -90, -20, -10]);
    const cached = JSON.parse(
      fs.readFileSync(
        cacheFiles().map((f) => path.join(cacheDir, f))[0]!,
        'utf8',
      ),
    );
    expect(cached.audio.every((v: unknown) => typeof v === 'number')).toBe(
      true,
    );
  });

  it('spreads sparse keyframe differences over the seconds they cover', async () => {
    const pending = analyzer.generateHeatmap('/v/gop.mp4', 12);
    // FFmpeg rebases pts_time to 0 whatever the container start time.
    emitAnalysis(await spawned(1), {
      duration: '00:00:12.00',
      start: '1.500000',
      frames: [
        [0, 0],
        [5, 10],
        [10, 20],
      ],
    });
    const result = await pending;
    expect(result.motion).toEqual([
      10, 10, 10, 10, 10, 20, 20, 20, 20, 20, 20, 20,
    ]);
  });

  it('parses output split across chunks', async () => {
    const pending = analyzer.generateHeatmap('/v/chunks.mp4', 1);
    const proc = await spawned(1);
    proc.err('  Duration: 00:00:02.00, st');
    proc.err('art: 0.0, bitrate: 1 kb/s\n');
    proc.out('frame:0 pts:0 pts_time:0\nlavfi.signalstats.YD');
    proc.out('IF=0\nframe:1 pts:1 pts_time:1\nlavfi.signalstats.YDIF=6');
    proc.err('[x] lavfi.astats.Overall.RMS_level=-12');
    proc.emit('close', 0);

    const result = await pending;
    expect(result.motion).toEqual([6]);
    expect(result.audio).toEqual([-12]);
  });

  it('caches the raw series once and resamples it for any point count', async () => {
    const p100 = analyzer.generateHeatmap('/v/a.mp4', 100);
    const p2 = analyzer.generateHeatmap('/v/a.mp4', 2);
    emitAnalysis(await spawned(1));
    const [r100, r2] = await Promise.all([p100, p2]);

    expect(r100.points).toBe(100);
    expect(r100.motion).toHaveLength(100);
    expect(r2).toEqual({ points: 2, motion: [6, 2], audio: [-20.5, -10.25] });

    // Another point count is served from the cache, without FFmpeg.
    const r4 = await analyzer.generateHeatmap('/v/a.mp4', 4);
    expect(r4.motion).toEqual([4, 8, 2, 2]);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockGetStreams).toHaveBeenCalledTimes(1);
  });

  it('serves cached heatmaps even when all analysis slots are busy', async () => {
    const cachedRun = analyzer.generateHeatmap('/v/cached.mp4', 2);
    emitAnalysis(await spawned(1));
    await cachedRun;

    const running = [1, 2, 3].map((i) =>
      analyzer.generateHeatmap(`/v/long-${i}.mp4`),
    );
    await spawned(4);

    await expect(analyzer.generateHeatmap('/v/cached.mp4', 2)).resolves.toEqual(
      { points: 2, motion: [6, 2], audio: [-20.5, -10.25] },
    );

    const busy = analyzer.generateHeatmap('/v/new.mp4');
    await expect(busy).rejects.toBeInstanceOf(HeatmapBusyError);
    await busy.catch((err: unknown) => {
      expect(isHeatmapBusyError(err)).toBe(true);
    });
    expect(mockSpawn).toHaveBeenCalledTimes(4);

    // Busy is not remembered as a failure: once a slot frees up it runs.
    processes.slice(1).forEach((proc) => emitAnalysis(proc));
    await Promise.all(running);
    const retry = analyzer.generateHeatmap('/v/new.mp4', 2);
    emitAnalysis(await spawned(5));
    await expect(retry).resolves.toMatchObject({ points: 2 });
  });

  it('re-analyses a file that was replaced, and ignores legacy or corrupt cache files', async () => {
    fs.writeFileSync(
      cachePathFor('/v/holiday.mp4', 'v1'),
      JSON.stringify({ version: 1, motion: [99], audio: [0] }),
    );
    mockGetIdentity.mockResolvedValue('v1');
    const first = analyzer.generateHeatmap('/v/holiday.mp4', 2);
    emitAnalysis(await spawned(1));
    expect((await first).motion).toEqual([6, 2]);

    mockGetIdentity.mockResolvedValue('v2');
    fs.writeFileSync(cachePathFor('/v/holiday.mp4', 'v2'), '{not json');
    const second = analyzer.generateHeatmap('/v/holiday.mp4', 2);
    emitAnalysis(await spawned(2), {
      frames: [
        [0, 0],
        [2, 30],
        [4, 40],
      ],
    });
    expect((await second).motion).toEqual([30, 40]);

    expect(
      cacheFiles().every((f) => /^heatmap_v2_[0-9a-f]{64}\.json$/.test(f)),
    ).toBe(true);
  });

  it('does not cache files whose identity is unknown', async () => {
    mockGetIdentity.mockResolvedValue(null);
    const first = analyzer.generateHeatmap('/v/unknown.mp4', 2);
    emitAnalysis(await spawned(1));
    await first;
    expect(cacheFiles()).toEqual([]);
  });

  it('remembers a failed analysis instead of re-running it on every open', async () => {
    const first = analyzer.generateHeatmap('/v/broken.mp4');
    emitAnalysis(await spawned(1), { code: 1 });
    await expect(first).rejects.toThrow('FFmpeg process exited with code 1');

    await expect(analyzer.generateHeatmap('/v/broken.mp4')).rejects.toThrow(
      'FFmpeg process exited with code 1',
    );
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // A new version of the file gets a fresh attempt.
    mockGetIdentity.mockResolvedValue('100-2');
    const fixed = analyzer.generateHeatmap('/v/broken.mp4', 2);
    emitAnalysis(await spawned(2));
    await expect(fixed).resolves.toMatchObject({ points: 2 });
  });

  it('rejects when FFmpeg cannot be spawned', async () => {
    const pending = analyzer.generateHeatmap('/v/spawn.mp4');
    const proc = await spawned(1);
    proc.emit('error', new Error('spawn ENOENT'));
    await expect(pending).rejects.toThrow('spawn ENOENT');
  });

  describe('cancellation', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    it('stops the analysis shortly after its last viewer leaves', async () => {
      const viewer = new AbortController();
      const pending = analyzer.generateHeatmap('/v/skimmed.mp4', 100, {
        signal: viewer.signal,
      });
      const proc = await spawned(1);

      viewer.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(proc.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

      // Cancelled work is not remembered as a failure.
      const again = analyzer.generateHeatmap('/v/skimmed.mp4', 2);
      emitAnalysis(await spawned(2));
      await expect(again).resolves.toMatchObject({ points: 2 });
    });

    it('keeps analysing while another viewer waits, and lets a returning viewer rejoin', async () => {
      const leaving = new AbortController();
      const left = analyzer.generateHeatmap('/v/shared.mp4', 2, {
        signal: leaving.signal,
      });
      const proc = await spawned(1);
      leaving.abort();
      await expect(left).rejects.toMatchObject({ name: 'AbortError' });

      // Rejoin within the grace period (e.g. a dropped request is retried).
      await vi.advanceTimersByTimeAsync(2000);
      const rejoined = analyzer.generateHeatmap('/v/shared.mp4', 2);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(proc.kill).not.toHaveBeenCalled();

      emitAnalysis(proc);
      await expect(rejoined).resolves.toMatchObject({ points: 2 });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('starts over when a viewer returns while an abandoned analysis is still winding down', async () => {
      // Probing a Drive/NAS source cannot be interrupted, so a cancelled job
      // can linger until the probe returns.
      let finishProbe!: (streams: {
        hasVideo: boolean;
        hasAudio: boolean;
      }) => void;
      mockGetStreams.mockReturnValueOnce(
        new Promise((resolve) => {
          finishProbe = resolve;
        }),
      );
      const leaving = new AbortController();
      const abandoned = analyzer.generateHeatmap('/v/slow-probe.mp4', 2, {
        signal: leaving.signal,
      });
      await vi.waitFor(() => expect(mockGetStreams).toHaveBeenCalledTimes(1));
      leaving.abort();
      await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(5000);

      const returning = analyzer.generateHeatmap('/v/slow-probe.mp4', 2);
      emitAnalysis(await spawned(1));
      await expect(returning).resolves.toMatchObject({ points: 2 });

      // The cancelled job gives up once its probe returns, without FFmpeg.
      finishProbe({ hasVideo: true, hasAudio: true });
      await new Promise((resolve) => setImmediate(resolve));
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(analyzer.getProgress('/v/slow-probe.mp4')).toBeNull();
      await expect(
        analyzer.generateHeatmap('/v/slow-probe.mp4', 2),
      ).resolves.toMatchObject({ points: 2 });
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('rejects immediately for an aborted signal', async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        analyzer.generateHeatmap('/v/x.mp4', 10, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(mockGetIdentity).not.toHaveBeenCalled();
    });

    it('scales the timeout with the media duration', async () => {
      const pending = analyzer.generateHeatmap('/v/feature.mkv');
      const proc = await spawned(1);
      proc.err('  Duration: 02:00:00.00, start: 0.000000, bitrate: 1 kb/s\n');

      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      expect(proc.kill).not.toHaveBeenCalled();

      const assertion = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(12 * 60 * 1000);
      await assertion;
      expect(proc.kill).toHaveBeenCalled();
    });

    it('times out after the minimum when the duration is unknown', async () => {
      const pending = analyzer.generateHeatmap('/v/stream.ts');
      const proc = await spawned(1);
      const assertion = expect(pending).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      await assertion;
      expect(proc.kill).toHaveBeenCalled();
    });
  });

  it('reports progress while analysing', async () => {
    const pending = analyzer.generateHeatmap('/v/progress.mp4', 2);
    const proc = await spawned(1);
    expect(analyzer.getProgress('/v/progress.mp4')).toBe(0);

    proc.err('  Duration: 00:10:00.00, start: 0.000000, bitrate: 1 kb/s\n');
    proc.err('size=N/A time=00:05:00.00 bitrate=N/A speed=90x\r');
    proc.err('size=N/A time=00:05:00.00 bitrate=N/A speed=90x\r\n');
    expect(analyzer.getProgress('/v/progress.mp4')).toBe(50);
    expect(analyzer.getProgress('/v/other.mp4')).toBeNull();

    emitAnalysis(proc, { duration: '00:10:00.00' });
    await pending;
    expect(analyzer.getProgress('/v/progress.mp4')).toBeNull();
  });

  it('throws if ffmpeg is not found', async () => {
    mockFFmpegPath.mockReturnValue(null);
    await expect(analyzer.generateHeatmap('/v/file.mp4', 10)).rejects.toThrow(
      'FFmpeg not found',
    );
  });

  it('returns flat data when heatmaps are disabled', async () => {
    process.env.DISABLE_HEATMAPS = 'true';
    const result = await analyzer.generateHeatmap('/v/any.mp4', 3);
    expect(result).toEqual({
      audio: [-90, -90, -90],
      motion: [0, 0, 0],
      points: 3,
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it.each([
    [Number.NaN, 100],
    [0, 1],
    [5000, 1000],
    [12.7, 12],
  ])('sanitizes %s points to %s', async (requested, expected) => {
    process.env.DISABLE_HEATMAPS = 'true';
    const result = await analyzer.generateHeatmap('/v/any.mp4', requested);
    expect(result.points).toBe(expected);
  });

  it('still returns the heatmap when the cache cannot be written', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blocker = path.join(cacheDir, 'not-a-dir');
    fs.writeFileSync(blocker, '');
    analyzer.setCacheDir(path.join(blocker, 'heatmaps'));

    const pending = analyzer.generateHeatmap('/v/nocache.mp4', 2);
    emitAnalysis(await spawned(1));
    await expect(pending).resolves.toMatchObject({ points: 2 });
    expect(warn).toHaveBeenCalledWith(
      '[MediaAnalyzer] Failed to write cache',
      expect.anything(),
    );
    warn.mockRestore();
  });

  it('sweeps heatmaps nobody used for months, including the legacy format', async () => {
    const dir = path.join(cacheDir, 'swept');
    fs.mkdirSync(dir);
    const legacy = path.join(dir, `heatmap_${'a'.repeat(64)}.json`);
    const current = path.join(dir, `heatmap_v2_${'b'.repeat(64)}.json`);
    const thumbnail = path.join(dir, `${'c'.repeat(32)}.jpg`);
    const longAgo = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    for (const file of [legacy, current, thumbnail]) {
      fs.writeFileSync(file, '{}');
    }
    fs.utimesSync(legacy, longAgo, longAgo);
    fs.utimesSync(thumbnail, longAgo, longAgo);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    analyzer.setCacheDir(dir);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    vi.useRealTimers();

    await vi.waitFor(() => expect(fs.existsSync(legacy)).toBe(false));
    expect(fs.existsSync(current)).toBe(true);
    expect(fs.existsSync(thumbnail)).toBe(true);
  });

  it('resetInstance() cancels running analyses', async () => {
    const pending = analyzer.generateHeatmap('/v/running.mp4');
    const proc = await spawned(1);
    MediaAnalyzer.resetInstance();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(proc.kill).toHaveBeenCalled();
  });
});
