import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { getFFmpegStreams } from '../utils/ffmpeg-utils';
import { createMediaSource } from '../media-source.ts';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface HeatmapData {
  audio: number[];
  motion: number[];
  points: number;
}

const DEFAULT_HEATMAP_POINTS = 100;
const MIN_HEATMAP_POINTS = 1;
const MAX_HEATMAP_POINTS = 1000;
const ANALYZER_TIMEOUT_MS = 2 * 60 * 1000;

export class MediaAnalyzer {
  private static instance: MediaAnalyzer;
  private cacheDir: string | null = null;
  private activeJobs: Map<
    string,
    { promise: Promise<HeatmapData>; progress: number }
  > = new Map();

  private constructor() {}

  static getInstance(): MediaAnalyzer {
    if (!MediaAnalyzer.instance) {
      MediaAnalyzer.instance = new MediaAnalyzer();
    }
    return MediaAnalyzer.instance;
  }

  /** @internal Used for testing */
  static resetInstance() {
    if (MediaAnalyzer.instance) {
      MediaAnalyzer.instance.activeJobs.clear();
    }
    MediaAnalyzer.instance = null as unknown as MediaAnalyzer;
  }

  setCacheDir(dir: string) {
    this.cacheDir = dir;
  }

  private getCachePath(filePath: string, points: number): string | null {
    if (!this.cacheDir) return null;
    const hash = crypto
      .createHash('sha256')
      .update(filePath + points)
      .digest('hex');
    return path.join(this.cacheDir, `heatmap_${hash}.json`);
  }

  getProgress(filePath: string): number | null {
    return this.activeJobs.get(filePath)?.progress ?? null;
  }

  async generateHeatmap(
    filePath: string,
    points: number = DEFAULT_HEATMAP_POINTS,
  ): Promise<HeatmapData> {
    const safePoints = this.sanitizePoints(points);
    if (process.env.DISABLE_HEATMAPS === 'true') {
      return {
        audio: new Array(safePoints).fill(-90),
        motion: new Array(safePoints).fill(0),
        points: safePoints,
      };
    }

    const existing = this.activeJobs.get(filePath);
    if (existing) return existing.promise;

    const processJob = async (): Promise<HeatmapData> => {
      // Check cache
      const cachePath = this.getCachePath(filePath, safePoints);
      if (cachePath) {
        try {
          const cached = await fs.readFile(cachePath, 'utf-8');
          return JSON.parse(cached);
        } catch {
          // Cache miss
        }
      }

      return this.executeHeatmapGeneration(filePath, safePoints);
    };

    const promise = processJob();
    this.activeJobs.set(filePath, { promise, progress: 0 });

    try {
      return await promise;
    } finally {
      this.activeJobs.delete(filePath);
    }
  }

  private async executeHeatmapGeneration(
    filePath: string,
    points: number,
  ): Promise<HeatmapData> {
    if (!ffmpegStatic) throw new Error('FFmpeg not found');

    const source = createMediaSource(filePath);
    const inputPath = await source.getFFmpegInput();
    const { hasVideo, hasAudio } = await getFFmpegStreams(
      inputPath,
      ffmpegStatic,
    );

    if (!hasVideo && !hasAudio)
      throw new Error('No video or audio streams found');

    const args = [
      '-i',
      inputPath,
      '-filter_complex',
      [
        hasVideo
          ? '[0:v]fps=1,scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-[v]'
          : '',
        hasAudio
          ? '[0:a]asetnsamples=22050,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-[a]'
          : '',
      ]
        .filter(Boolean)
        .join(';'),
      ...(hasVideo ? ['-map', '[v]'] : []),
      ...(hasAudio ? ['-map', '[a]'] : []),
      '-f',
      'null',
      '-',
    ];

    const output = await this.spawnFFmpegAndCaptureOutput(filePath, args);
    const { motion, audio } = this.parseHeatmapOutput(output);

    const result = {
      audio: this.resample(audio, points, -90),
      motion: this.resample(motion, points, 0),
      points,
    };

    const cachePath = this.getCachePath(filePath, points);
    if (cachePath) {
      try {
        await fs.mkdir(path.dirname(cachePath), { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify(result));
      } catch (cacheErr) {
        console.warn('[MediaAnalyzer] Failed to write cache', cacheErr);
      }
    }

    return result;
  }

  private async spawnFFmpegAndCaptureOutput(
    filePath: string,
    args: string[],
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(ffmpegStatic!, args, { windowsHide: true });
      const timeoutTimer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Heatmap generation timed out'));
      }, ANALYZER_TIMEOUT_MS);

      let output = '',
        stderrBuffer = '',
        durationSec = 0;

      proc.stdout?.on('data', (d) => (output += d.toString()));
      proc.stderr?.on('data', (d) => {
        stderrBuffer += d.toString();
        if (!durationSec) {
          const match = stderrBuffer.match(
            /Duration: (\d+):(\d+):(\d+)\.(\d+)/,
          );
          if (match)
            durationSec =
              parseInt(match[1]) * 3600 +
              parseInt(match[2]) * 60 +
              parseFloat(`${match[3]}.${match[4]}`);
        }
        if (durationSec > 0) {
          const match = stderrBuffer.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
          if (match) {
            const currentSec =
              parseInt(match[1]) * 3600 +
              parseInt(match[2]) * 60 +
              parseFloat(`${match[3]}.${match[4]}`);
            const job = this.activeJobs.get(filePath);
            if (job)
              job.progress = Math.min(
                100,
                Math.round((currentSec / durationSec) * 100),
              );
          }
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutTimer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (code !== 0)
          reject(new Error(`FFmpeg process exited with code ${code}`));
        else {
          if (stderrBuffer.includes('Error'))
            console.warn(
              '[MediaAnalyzer] FFmpeg succeeded but reported errors',
            );
          resolve(output);
        }
      });
    });
  }

  private parseHeatmapOutput(output: string) {
    const motion: number[] = [],
      audio: number[] = [];
    output.split(/[\r\n]+/).forEach((line) => {
      const mMatch = line.match(/lavfi\.signalstats\.YDIF=([0-9\.]+)/);
      if (mMatch) motion.push(parseFloat(mMatch[1]));
      const aMatch = line.match(
        /lavfi\.astats\.Overall\.RMS_level=([0-9\.\-]+)/,
      );
      if (aMatch) audio.push(parseFloat(aMatch[1]));
    });
    return { motion, audio };
  }

  private resample(
    data: number[],
    target: number,
    defaultValue: number,
  ): number[] {
    if (data.length === 0) return new Array(target).fill(defaultValue);
    const result: number[] = [],
      step = data.length / target;
    for (let i = 0; i < target; i++) {
      const start = Math.floor(i * step),
        end = Math.floor((i + 1) * step);
      const slice = data.slice(start, end);
      result.push(
        slice.length > 0
          ? slice.reduce((a, b) => a + b, 0) / slice.length
          : (data[start] ?? defaultValue),
      );
    }
    return result;
  }

  private sanitizePoints(points: number): number {
    if (!Number.isFinite(points)) return DEFAULT_HEATMAP_POINTS;
    return Math.max(
      MIN_HEATMAP_POINTS,
      Math.min(MAX_HEATMAP_POINTS, Math.floor(points)),
    );
  }
}
