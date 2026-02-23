import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';
import { getFFmpegStreams, runFFmpeg } from '../utils/ffmpeg-utils';
import { createMediaSource } from '../media-source.ts';
import { MAX_QUEUE_SIZE } from '../constants.ts';
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

  private constructor() {}

  static getInstance(): MediaAnalyzer {
    if (!MediaAnalyzer.instance) {
      MediaAnalyzer.instance = new MediaAnalyzer();
    }
    return MediaAnalyzer.instance;
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

  private activeJobs: Map<
    string,
    { promise: Promise<HeatmapData>; progress: number }
  > = new Map();

  getProgress(filePath: string): number | null {
    const job = this.activeJobs.get(filePath);
    return job ? job.progress : null;
  }

  private isProcessing = false;
  private jobQueue: Array<() => Promise<void>> = [];

  async generateHeatmap(
    filePath: string,
    points: number = DEFAULT_HEATMAP_POINTS,
  ): Promise<HeatmapData> {
    const existingJob = this.activeJobs.get(filePath);
    if (existingJob) {
      // Return existing promise if already queued or running
      return existingJob.promise;
    }

    // Create a deferred promise to return immediately
    let deferredResolve: (
      value: HeatmapData | PromiseLike<HeatmapData>,
    ) => void;
    let deferredReject: (reason?: unknown) => void;

    const jobPromise = new Promise<HeatmapData>((resolve, reject) => {
      deferredResolve = resolve;
      deferredReject = reject;
    });

    // Register job immediately as 0% progress
    this.activeJobs.set(filePath, { promise: jobPromise, progress: 0 });

    const work = async () => {
      try {
        const result = await this.executeHeatmapGeneration(filePath, points);
        deferredResolve!(result);
      } catch (e) {
        deferredReject!(e);
      } finally {
        // Cleanup after completion/failure
        this.activeJobs.delete(filePath);
      }
    };

    // [SECURITY] Enforce queue limit to prevent DoS
    if (this.jobQueue.length >= MAX_QUEUE_SIZE) {
      throw new Error('Server busy: Heatmap queue full');
    }

    // Add to queue and trigger processing
    this.jobQueue.push(work);
    this.processQueue();

    return jobPromise;
  }

  private async processQueue() {
    if (this.isProcessing) return; // Busy

    this.isProcessing = true;

    try {
      while (this.jobQueue.length > 0) {
        const nextWork = this.jobQueue.shift();
        if (nextWork) {
          await nextWork();
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private constructFFmpegArgs(
    inputPath: string,
    hasVideo: boolean,
    hasAudio: boolean,
  ): string[] {
    const inputs = ['-i', inputPath];
    const filterChains: string[] = [];
    const mapArgs: string[] = [];

    // Dynamic Filter Chain Construction
    // Optimize: Scale down to 320px width to speed up signalstats (YDIF calculation)
    const videoAnalysisFilter = `[0:v]fps=1,scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-[v]`;
    const audioAnalysisFilter = `[0:a]asetnsamples=22050,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-[a]`;

    if (hasVideo) {
      filterChains.push(videoAnalysisFilter);
      mapArgs.push('-map', '[v]');
    }

    if (hasAudio) {
      filterChains.push(audioAnalysisFilter);
      mapArgs.push('-map', '[a]');
    }

    return [
      ...inputs,
      '-filter_complex',
      filterChains.join(';'),
      ...mapArgs,
      '-f',
      'null',
      '-',
    ];
  }

  private async spawnFFmpegAndCaptureOutput(
    filePath: string,
    args: string[],
    onProgress: (progress: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = spawn(ffmpegStatic!, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeoutTimer = setTimeout(() => {
        console.warn(`[MediaAnalyzer] Process timed out for ${filePath}`);
        process.kill('SIGKILL');
        reject(new Error('Heatmap generation timed out'));
      }, ANALYZER_TIMEOUT_MS);

      let output = '';
      let errorOutput = '';
      let durationSec = 0;
      let stderrBuffer = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        const str = data.toString();
        errorOutput += str;
        stderrBuffer += str;

        const lines = stderrBuffer.split(/[\r\n]+/);
        // Keep the last partial line (or empty string if ends with newline) in buffer
        stderrBuffer = lines.pop() || '';

        for (const line of lines) {
          // Parse Duration if not yet found
          if (!durationSec) {
            const durMatch = line.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
            if (durMatch) {
              const h = parseInt(durMatch[1], 10);
              const m = parseInt(durMatch[2], 10);
              const s = parseInt(durMatch[3], 10);
              durationSec = h * 3600 + m * 60 + s;
            }
          }

          // Parse Progress
          if (durationSec > 0) {
            const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
            if (timeMatch) {
              const h = parseInt(timeMatch[1], 10);
              const m = parseInt(timeMatch[2], 10);
              const s = parseInt(timeMatch[3], 10);
              const currentSec = h * 3600 + m * 60 + s;
              const progress = Math.min(
                100,
                Math.round((currentSec / durationSec) * 100),
              );
              onProgress(progress);
            }
          }
        }
      });

      process.on('error', (err) => {
        console.error('[MediaAnalyzer] Failed to start ffmpeg process:', err);
        reject(err);
      });

      process.on('close', (code) => {
        clearTimeout(timeoutTimer);
        if (code !== 0) {
          console.error(`[MediaAnalyzer] FFmpeg exited with code ${code}`);
          console.error(`[MediaAnalyzer] Stderr: ${errorOutput.slice(-1000)}`);
          reject(new Error(`FFmpeg process exited with code ${code}`));
          return;
        }

        if (errorOutput.includes('Error')) {
          console.warn(
            `[MediaAnalyzer] FFmpeg succeeded but reported errors: ${errorOutput.slice(-500)}`,
          );
        }
        resolve(output);
      });
    });
  }

  private parseHeatmapOutput(
    output: string,
    filePath: string,
  ): { motion: number[]; audio: number[] } {
    const motionValues: number[] = [];
    const audioValues: number[] = [];

    // Regex for more robust parsing
    // Matches: lavfi.signalstats.YDIF=1.234 or lavfi.signalstats.YDIF= 1.234
    const ydifRegex = /lavfi\.signalstats\.YDIF\s*=\s*([0-9\.]+)/;
    const audioRegex = /lavfi\.astats\.Overall\.RMS_level\s*=\s*([0-9\.\-]+)/;

    const lines = output.split(/[\r\n]+/);
    for (const line of lines) {
      const ydifMatch = line.match(ydifRegex);
      if (ydifMatch) {
        const val = parseFloat(ydifMatch[1]);
        if (!isNaN(val)) motionValues.push(val);
      }

      const audioMatch = line.match(audioRegex);
      if (audioMatch) {
        const val = parseFloat(audioMatch[1]);
        if (!isNaN(val)) audioValues.push(val);
      }
    }

    if (motionValues.length === 0 && audioValues.length === 0) {
      console.warn(
        `[MediaAnalyzer] Warning: Zero samples found for ${filePath}`,
      );
      console.warn(
        `[MediaAnalyzer] Output sample (last 5 lines): ${lines.slice(-5).join('\n')}`,
      );
    }

    console.log(
      `[MediaAnalyzer] Parsed ${motionValues.length} motion samples and ${audioValues.length} audio samples.`,
    );

    return { motion: motionValues, audio: audioValues };
  }

  // Renamed the original logic to this method
  private async executeHeatmapGeneration(
    filePath: string,
    points: number,
  ): Promise<HeatmapData> {
    const safePoints = this.sanitizePoints(points);
    if (!ffmpegStatic) {
      throw new Error('FFmpeg not found');
    }

    console.log(
      `[MediaAnalyzer] Generating heatmap for ${filePath} with ${safePoints} points`,
    );

    // Check cache
    const cachePath = this.getCachePath(filePath, safePoints);
    if (cachePath) {
      try {
        const cached = await fs.readFile(cachePath, 'utf-8');
        return JSON.parse(cached);
      } catch {
        // Cache miss, continue with FFmpeg
      }
    }

    // Resolve input path handling gdrive:// etc
    const source = createMediaSource(filePath);
    const inputPath = await source.getFFmpegInput();

    // Check for streams using resolved path
    const { hasVideo, hasAudio } = await getFFmpegStreams(
      inputPath,
      ffmpegStatic!,
    );

    if (!hasVideo && !hasAudio) {
      console.error(`[MediaAnalyzer] No streams found for ${filePath}`);
      // Re-run probe to capture stderr for debugging
      try {
        const { stderr } = await runFFmpeg(ffmpegStatic!, ['-i', inputPath]);
        console.error(`[MediaAnalyzer] Probe stderr: ${stderr}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[MediaAnalyzer] Probe stderr (from error): ${msg}`);
      }
      throw new Error('No video or audio streams found');
    }

    const args = this.constructFFmpegArgs(inputPath, hasVideo, hasAudio);

    const output = await this.spawnFFmpegAndCaptureOutput(
      filePath,
      args,
      (progress) => {
        const job = this.activeJobs.get(filePath);
        if (job) {
          job.progress = progress;
        }
      },
    );

    const { motion, audio } = this.parseHeatmapOutput(output, filePath);

    // Downsample to `points`
    const resampledAudio = this.resample(audio, safePoints, -90);
    const resampledMotion = this.resample(motion, safePoints, 0);

    const result: HeatmapData = {
      audio: resampledAudio,
      motion: resampledMotion,
      points: safePoints,
    };

    // Cache result
    if (cachePath) {
      const dir = path.dirname(cachePath);
      try {
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(cachePath, JSON.stringify(result));
      } catch (cacheErr) {
        console.warn('[MediaAnalyzer] Failed to write cache', cacheErr);
      }
    }

    return result;
  }

  // Simple bucket average resampling
  private resample(
    data: number[],
    targetLength: number,
    defaultValue: number,
  ): number[] {
    const safeTargetLength = this.sanitizePoints(targetLength);
    if (data.length === 0) {
      return new Array(safeTargetLength).fill(defaultValue);
    }

    const result: number[] = [];
    const step = data.length / safeTargetLength;

    for (let i = 0; i < safeTargetLength; i++) {
      const start = Math.floor(i * step);
      const end = Math.floor((i + 1) * step);
      const slice = data.slice(start, end);

      // Note: When downsampling, slice will have 1 or more items.
      // When upsampling, slice can be empty.
      if (slice.length > 0) {
        const sum = slice.reduce((a, b) => a + b, 0);
        result.push(sum / slice.length);
      } else {
        // Updated Up-sampling Logic:
        // If slice is empty (start == end), we are zooming in on a single point.
        // Use data[start] if available, otherwise fallback.
        if (start < data.length) {
          result.push(data[start]);
        } else {
          // Should be unreachable with current math, but safe fallback to default
          result.push(defaultValue);
        }
      }
    }
    return result;
  }

  private sanitizePoints(points: number): number {
    if (!Number.isFinite(points)) return DEFAULT_HEATMAP_POINTS;
    const rounded = Math.floor(points);
    if (rounded < MIN_HEATMAP_POINTS) return MIN_HEATMAP_POINTS;
    return Math.min(MAX_HEATMAP_POINTS, rounded);
  }
}
