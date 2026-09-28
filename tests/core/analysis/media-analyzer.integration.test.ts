// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vite-plus/test';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import { MediaAnalyzer } from '../../../src/core/media/analysis/media-analyzer';

// Authorization is out of scope here; FFmpeg, parsing and the cache are real.
vi.mock('../../../src/core/media/media-source', () => ({
  createMediaSource: (filePath: string) => ({
    getFFmpegInput: async () => filePath,
  }),
}));

function ffmpeg(args: string[]): void {
  const result = spawnSync(ffmpegPath!, ['-hide_banner', '-y', ...args]);
  if (result.status !== 0) throw new Error(result.stderr.toString());
}

describe('MediaAnalyzer (integration)', () => {
  let tmp: string;
  let clip: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'heatmap-int-'));
    clip = path.join(tmp, 'intro.mp4');
    // 8 s of moving video with keyframes every 2 s; 3 s of silence, then a tone.
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25:duration=8',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=mono:d=3',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=44100:duration=5',
      '-filter_complex',
      '[1:a][2:a]concat=n=2:v=0:a=1[a]',
      '-map',
      '0:v',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '50',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      clip,
    ]);

    MediaAnalyzer.resetInstance();
    MediaAnalyzer.getInstance().setCacheDir(path.join(tmp, 'cache'));
    process.env.DISABLE_HEATMAPS = 'false';
  }, 60_000);

  afterAll(() => {
    MediaAnalyzer.resetInstance();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('produces finite motion and audio values, with silence at the floor', async () => {
    const result = await MediaAnalyzer.getInstance().generateHeatmap(clip, 8);

    expect(result.points).toBe(8);
    expect(result.motion.every(Number.isFinite)).toBe(true);
    expect(result.audio.every(Number.isFinite)).toBe(true);
    expect(Math.max(...result.motion)).toBeGreaterThan(0);

    // The first seconds are silent (-inf in astats) and the rest is a tone.
    expect(result.audio[0]).toBe(-90);
    expect(result.audio[1]).toBe(-90);
    expect(result.audio[7]).toBeGreaterThan(-40);

    const [cacheFile] = fs.readdirSync(path.join(tmp, 'cache'));
    const cached = JSON.parse(
      fs.readFileSync(path.join(tmp, 'cache', cacheFile!), 'utf8'),
    );
    expect(cached.version).toBe(2);
    expect(cached.motion).toHaveLength(8); // one value per second
  }, 60_000);

  it('answers other point counts from the cached series', async () => {
    const result = await MediaAnalyzer.getInstance().generateHeatmap(clip, 4);
    expect(result.points).toBe(4);
    expect(result.audio[0]).toBe(-90);
  });

  it('places motion at the same seconds when the timestamps do not start at 0', async () => {
    // Black, white from 4 s to 7 s, then black again; a keyframe every second.
    const fromZero = path.join(tmp, 'flash.mp4');
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      "color=c=black:size=320x240:rate=25:duration=10,drawbox=w=iw:h=ih:color=white:t=fill:enable='gte(t,4)*lt(t,7)'",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '25',
      '-sc_threshold',
      '0',
      '-pix_fmt',
      'yuv420p',
      fromZero,
    ]);
    // The same frames as MPEG-TS starting at ~101 s, like camcorder (AVCHD)
    // clips and broadcast recordings.
    const offset = path.join(tmp, 'flash.ts');
    ffmpeg([
      '-i',
      fromZero,
      '-c',
      'copy',
      '-output_ts_offset',
      '100',
      '-f',
      'mpegts',
      offset,
    ]);

    const analyzer = MediaAnalyzer.getInstance();
    const expected = await analyzer.generateHeatmap(fromZero, 10);
    const shifted = await analyzer.generateHeatmap(offset, 10);

    // Each second shows the change up to the next keyframe: the cuts at 4 s and 7 s.
    const peaks = (motion: number[]) =>
      motion.flatMap((value, second) => (value > 100 ? [second] : []));
    expect(peaks(expected.motion)).toEqual([3, 6]);
    expect(peaks(shifted.motion)).toEqual([3, 6]);
  }, 60_000);
});
