import { spawn } from 'child_process';
import { getFFmpegStaticPath } from '../../../infrastructure/ffmpeg-static-path';
import { getFFmpegEnv } from '../../../infrastructure/ffmpeg-env.ts';
import {
  getFFmpegStreams,
  getInputSafetyArgs,
} from '../../../infrastructure/ffmpeg-utils';
import { createMediaSource } from '../media-source.ts';
import { getFileIdentity } from '../file-identity.ts';
import { SharedTask } from '../utils/shared-task.ts';
import { CacheSweeper } from '../utils/cache-maintenance.ts';
import { HeatmapBusyError } from './heatmap-errors.ts';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface HeatmapData {
  audio: number[];
  motion: number[];
  points: number;
}

/**
 * Raw analysis of one file version. It is cached once and resampled for every
 * requested point count.
 */
interface HeatmapSeries {
  /** Luma difference per second of media. */
  motion: number[];
  /** RMS level in dBFS per audio chunk, floored at AUDIO_FLOOR_DB. */
  audio: number[];
}

interface JobState {
  filePath: string;
  progress: number;
}

interface AnalysisJob {
  state: JobState;
  task: SharedTask<HeatmapSeries>;
}

interface AnalysisOutput {
  motionSamples: { time: number; value: number }[];
  audio: number[];
  durationSec: number;
}

const DEFAULT_HEATMAP_POINTS = 100;
const MIN_HEATMAP_POINTS = 1;
const MAX_HEATMAP_POINTS = 1000;
const MAX_CONCURRENT_ANALYSES = 3;
/** Silence: astats reports -inf dBFS, which is stored as this floor. */
const AUDIO_FLOOR_DB = -90;
/** Bump when the cached format or the analysis changes. */
const CACHE_VERSION = 2;
const CACHE_FILE_PREFIX = 'heatmap_v2_';
/** Timeout before the duration is known, and the lower bound after. */
const ANALYZER_MIN_TIMEOUT_MS = 2 * 60 * 1000;
const ANALYZER_MAX_TIMEOUT_MS = 30 * 60 * 1000;
/** Slowest acceptable analysis speed (multiple of realtime) used to scale the timeout. */
const ANALYZER_MIN_SPEED = 8;
/** Decoder threads per analysis, so analyses do not starve playback/HLS. */
const ANALYZER_THREADS = '2';
/**
 * How long an analysis keeps running after its last viewer left, so a client
 * that reconnects (e.g. after a dropped request) rejoins it instead of
 * starting over.
 */
const ABANDONED_ANALYSIS_GRACE_MS = 5 * 1000;
/** A failed analysis is not retried for this long, unless the file changes. */
const FAILURE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_REMEMBERED_FAILURES = 1000;

const HEATMAP_FILE = /^heatmap_(?:v2_)?[0-9a-f]{64}\.json$/;
const HEATMAP_TEMP_FILE = /^heatmap_v2_[0-9a-f]{64}\.json\.[0-9a-f-]+\.tmp$/;

const TIME_PATTERN = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/;
const DURATION_PATTERN = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/;
const PTS_TIME_PATTERN = /pts_time:(-?\d+(?:\.\d+)?)/;
const MOTION_PATTERN = /lavfi\.signalstats\.YDIF=(\S+)/;
const AUDIO_PATTERN = /lavfi\.astats\.Overall\.RMS_level=(\S+)/;

function toSeconds(h = '0', m = '0', s = '0'): number {
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Parses an astats RMS level; silence is reported as "-inf". */
function parseRmsLevel(raw: string): number | null {
  if (/^-?inf$/i.test(raw)) return AUDIO_FLOOR_DB;
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return Math.max(AUDIO_FLOOR_DB, value);
}

function toFiniteNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const result: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isFinite(item)) return null;
    result.push(item);
  }
  return result;
}

function parseCachedSeries(raw: string): HeatmapSeries | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  if (record.version !== CACHE_VERSION) return null;
  const motion = toFiniteNumbers(record.motion);
  const audio = toFiniteNumbers(record.audio);
  return motion && audio ? { motion, audio } : null;
}

/**
 * Turns per-keyframe luma differences into one value per second. Each sample
 * measures the change since the previous sample, so it is spread over the
 * seconds between the two.
 */
function buildMotionSeries(
  samples: { time: number; value: number }[],
  durationSec: number,
): number[] {
  const last = samples[samples.length - 1];
  const length = Math.max(
    1,
    Math.ceil(durationSec > 0 ? durationSec : (last?.time ?? 0) + 1),
  );
  const series = new Array<number>(length).fill(0);
  if (samples.length < 2) return series;

  let k = 1;
  for (let second = 0; second < length; second++) {
    const midpoint = second + 0.5;
    while (k < samples.length - 1 && (samples[k]?.time ?? 0) <= midpoint) k++;
    series[second] = round(samples[k]?.value ?? 0, 3);
  }
  return series;
}

function buildAnalysisArgs(
  inputPath: string,
  hasVideo: boolean,
  hasAudio: boolean,
): string[] {
  const chains: string[] = [];
  if (hasVideo) {
    // Keyframes only (-skip_frame below), thinned to at most one per second.
    // The metadata lines go to stdout together with each frame's pts_time.
    chains.push(
      "[0:v]select='isnan(prev_selected_t)+gte(t-prev_selected_t,1)',scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YDIF:file=-[v]",
    );
  }
  if (hasAudio) {
    // Logged to stderr: a second metadata printer on stdout would interleave
    // its buffered writes with the video lines.
    chains.push(
      '[0:a]asetnsamples=22050,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level[a]',
    );
  }
  return [
    '-hide_banner',
    '-nostdin',
    '-threads',
    ANALYZER_THREADS,
    // Decode keyframes only: a full decode of a feature film takes minutes.
    '-skip_frame',
    'nokey',
    ...getInputSafetyArgs(inputPath),
    '-i',
    inputPath,
    '-filter_complex_threads',
    '1',
    '-filter_complex',
    chains.join(';'),
    ...(hasVideo ? ['-map', '[v]'] : []),
    ...(hasAudio ? ['-map', '[a]'] : []),
    '-f',
    'null',
    '-',
  ];
}

/** Splits a stream of chunks into lines, keeping partial lines for later. */
function lineReader(onLine: (line: string) => void) {
  let buffer = '';
  return {
    push(chunk: Buffer) {
      buffer += chunk.toString();
      const lines = buffer.split(/[\r\n]+/);
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    },
    flush() {
      if (buffer) onLine(buffer);
      buffer = '';
    },
  };
}

export class MediaAnalyzer {
  private static instance: MediaAnalyzer | null = null;
  private cacheDir: string | null = null;
  /** In-flight jobs (cache read and/or analysis) keyed by file version. */
  private jobs = new Map<string, AnalysisJob>();
  private runningAnalyses = 0;
  private failures = new Map<string, { message: string; expiresAt: number }>();
  private sweeper = new CacheSweeper({
    isEntry: (name) => HEATMAP_FILE.test(name),
    isTempFile: (name) => HEATMAP_TEMP_FILE.test(name),
    maxAgeMs: 180 * 24 * 60 * 60 * 1000,
    tempMaxAgeMs: 60 * 60 * 1000,
  });

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
      for (const job of MediaAnalyzer.instance.jobs.values()) {
        job.task.cancel();
      }
      MediaAnalyzer.instance.jobs.clear();
    }
    MediaAnalyzer.instance = null;
  }

  setCacheDir(dir: string) {
    this.cacheDir = dir;
    this.sweeper.maybeSweep(dir);
  }

  private getCachePath(versionKey: string): string | null {
    if (!this.cacheDir) return null;
    const hash = crypto.createHash('sha256').update(versionKey).digest('hex');
    return path.join(this.cacheDir, `${CACHE_FILE_PREFIX}${hash}.json`);
  }

  getProgress(filePath: string): number | null {
    for (const job of this.jobs.values()) {
      if (job.state.filePath === filePath) return job.state.progress;
    }
    return null;
  }

  /**
   * Returns the heatmap of a file, from the cache or by analysing it.
   * Concurrent requests for the same file share one analysis, whatever their
   * point count. When `signal` aborts the request is rejected, and the
   * analysis stops once no other request is waiting for it.
   * @throws HeatmapBusyError when a new analysis is needed but all slots are taken.
   */
  async generateHeatmap(
    filePath: string,
    points: number = DEFAULT_HEATMAP_POINTS,
    options: { signal?: AbortSignal } = {},
  ): Promise<HeatmapData> {
    const safePoints = this.sanitizePoints(points);
    if (process.env.DISABLE_HEATMAPS === 'true') {
      return {
        audio: Array.from({ length: safePoints }, () => AUDIO_FLOOR_DB),
        motion: Array.from({ length: safePoints }, () => 0),
        points: safePoints,
      };
    }
    options.signal?.throwIfAborted();

    // Size + mtime (or the Drive metadata) make a replaced file a new entry.
    const identity = await getFileIdentity(filePath);
    const versionKey = identity ? `${filePath}\0${identity}` : null;
    const jobKey = versionKey ?? filePath;

    const failure = this.failures.get(jobKey);
    if (failure) {
      if (failure.expiresAt > Date.now()) throw new Error(failure.message);
      this.failures.delete(jobKey);
    }

    // A cancelled job stays listed until it settles, which can take a while
    // when the abort lands in a probe that cannot be interrupted; joining it
    // would fail this request, so a fresh job replaces it.
    const existing = this.jobs.get(jobKey);
    const job =
      existing && !existing.task.signal.aborted
        ? existing
        : this.startJob(filePath, jobKey, versionKey);
    const series = await job.task.join(options.signal);
    return {
      audio: this.resample(series.audio, safePoints, AUDIO_FLOOR_DB),
      motion: this.resample(series.motion, safePoints, 0),
      points: safePoints,
    };
  }

  private startJob(
    filePath: string,
    jobKey: string,
    versionKey: string | null,
  ): AnalysisJob {
    const state: JobState = { filePath, progress: 0 };
    const job: AnalysisJob = {
      state,
      task: new SharedTask(
        (signal) => this.runJob(state, jobKey, versionKey, signal),
        ABANDONED_ANALYSIS_GRACE_MS,
      ),
    };
    this.jobs.set(jobKey, job);
    const cleanup = () => {
      if (this.jobs.get(jobKey) === job) this.jobs.delete(jobKey);
    };
    job.task.promise.then(cleanup, cleanup);
    return job;
  }

  private async runJob(
    job: JobState,
    jobKey: string,
    versionKey: string | null,
    signal: AbortSignal,
  ): Promise<HeatmapSeries> {
    // Without an identity the file cannot be versioned, so it is not cached.
    const cachePath = versionKey ? this.getCachePath(versionKey) : null;
    if (cachePath) {
      const cached = await this.readCache(cachePath);
      if (cached) return cached;
    }
    signal.throwIfAborted();

    // Only the FFmpeg phase counts against the limit: cache hits never wait.
    if (this.runningAnalyses >= MAX_CONCURRENT_ANALYSES) {
      throw new HeatmapBusyError();
    }
    this.runningAnalyses++;
    try {
      const series = await this.analyze(job, signal);
      if (cachePath) await this.writeCache(cachePath, series);
      return series;
    } catch (err) {
      if (!signal.aborted) this.rememberFailure(jobKey, err);
      throw err;
    } finally {
      this.runningAnalyses--;
    }
  }

  private async readCache(cachePath: string): Promise<HeatmapSeries | null> {
    let raw: string;
    try {
      raw = await fs.readFile(cachePath, 'utf-8');
    } catch {
      return null; // Cache miss
    }
    const series = parseCachedSeries(raw);
    if (series) this.sweeper.touch(cachePath);
    return series;
  }

  private async writeCache(
    cachePath: string,
    series: HeatmapSeries,
  ): Promise<void> {
    // Write-then-rename so a concurrent reader never sees a partial file.
    const tempPath = `${cachePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(cachePath), { recursive: true });
      await fs.writeFile(
        tempPath,
        JSON.stringify({ version: CACHE_VERSION, ...series }),
      );
      await fs.rename(tempPath, cachePath);
    } catch (cacheErr) {
      console.warn('[MediaAnalyzer] Failed to write cache', cacheErr);
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  private rememberFailure(jobKey: string, err: unknown): void {
    if (this.failures.size >= MAX_REMEMBERED_FAILURES) {
      const oldest = this.failures.keys().next().value;
      if (oldest !== undefined) this.failures.delete(oldest);
    }
    this.failures.set(jobKey, {
      message: err instanceof Error ? err.message : String(err),
      expiresAt: Date.now() + FAILURE_TTL_MS,
    });
  }

  private async analyze(
    job: JobState,
    signal: AbortSignal,
  ): Promise<HeatmapSeries> {
    const ffmpegPath = getFFmpegStaticPath();
    if (!ffmpegPath) throw new Error('FFmpeg not found');

    const source = createMediaSource(job.filePath);
    const inputPath = await source.getFFmpegInput();
    const { hasVideo, hasAudio } = await getFFmpegStreams(
      inputPath,
      ffmpegPath,
    );

    if (!hasVideo && !hasAudio)
      throw new Error('No video or audio streams found');
    signal.throwIfAborted();

    const output = await this.runAnalysis(
      ffmpegPath,
      buildAnalysisArgs(inputPath, hasVideo, hasAudio),
      job,
      signal,
    );

    // FFmpeg already rebases input timestamps to 0 (no -copyts), so pts_time
    // is relative to the start even when the container starts later (e.g.
    // MPEG-TS/AVCHD). Only small negative times, from edit lists, are clamped.
    const motionSamples = output.motionSamples.map((sample) => ({
      time: Math.max(0, sample.time),
      value: sample.value,
    }));
    const audio: number[] = [];
    for (const value of output.audio) audio.push(round(value, 2));

    return {
      motion: hasVideo
        ? buildMotionSeries(motionSamples, output.durationSec)
        : [],
      audio,
    };
  }

  private runAnalysis(
    ffmpegPath: string,
    args: string[],
    job: JobState,
    signal: AbortSignal,
  ): Promise<AnalysisOutput> {
    return new Promise((resolve, reject) => {
      const output: AnalysisOutput = {
        motionSamples: [],
        audio: [],
        durationSec: 0,
      };
      const proc = spawn(ffmpegPath, args, {
        windowsHide: true,
        env: getFFmpegEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const startedAt = Date.now();
      let settled = false;
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        signal.removeEventListener('abort', onAbort);
        proc.kill('SIGKILL');
        reject(err);
      };
      const onAbort = () =>
        fail(new DOMException('Heatmap analysis was cancelled.', 'AbortError'));
      const armTimeout = (ms: number) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        const remaining = Math.max(0, ms - (Date.now() - startedAt));
        timeoutTimer = setTimeout(
          () => fail(new Error('Heatmap generation timed out')),
          remaining,
        );
      };
      armTimeout(ANALYZER_MIN_TIMEOUT_MS);
      signal.addEventListener('abort', onAbort, { once: true });

      // stdout: "frame:N pts:P pts_time:T" followed by that frame's YDIF.
      let frameTime: number | null = null;
      const stdout = lineReader((line) => {
        const pts = PTS_TIME_PATTERN.exec(line);
        if (pts?.[1]) {
          frameTime = parseFloat(pts[1]);
          return;
        }
        const motion = MOTION_PATTERN.exec(line);
        if (motion?.[1] && frameTime !== null) {
          const value = parseFloat(motion[1]);
          if (Number.isFinite(value)) {
            output.motionSamples.push({ time: frameTime, value });
          }
          frameTime = null;
        }
      });

      // stderr: stream info, progress and the audio levels.
      const stderr = lineReader((line) => {
        const audio = AUDIO_PATTERN.exec(line);
        if (audio?.[1]) {
          const level = parseRmsLevel(audio[1]);
          if (level !== null) output.audio.push(level);
          return;
        }
        if (!output.durationSec) {
          const duration = DURATION_PATTERN.exec(line);
          if (duration) {
            output.durationSec = toSeconds(
              duration[1],
              duration[2],
              duration[3],
            );
            // Long files get proportionally more time.
            armTimeout(
              Math.min(
                ANALYZER_MAX_TIMEOUT_MS,
                Math.max(
                  ANALYZER_MIN_TIMEOUT_MS,
                  (output.durationSec * 1000) / ANALYZER_MIN_SPEED,
                ),
              ),
            );
            return;
          }
        }
        if (output.durationSec > 0) {
          const time = TIME_PATTERN.exec(line);
          if (time) {
            const currentSec = toSeconds(time[1], time[2], time[3]);
            job.progress = Math.min(
              100,
              Math.round((currentSec / output.durationSec) * 100),
            );
          }
        }
      });

      proc.stdout?.on('data', (d: Buffer) => stdout.push(d));
      proc.stderr?.on('data', (d: Buffer) => stderr.push(d));

      proc.on('error', (err) => fail(err));
      proc.on('close', (code) => {
        if (settled) return;
        stdout.flush();
        stderr.flush();
        if (code !== 0) {
          fail(new Error(`FFmpeg process exited with code ${code}`));
          return;
        }
        settled = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        signal.removeEventListener('abort', onAbort);
        resolve(output);
      });
    });
  }

  private resample(
    data: number[],
    target: number,
    defaultValue: number,
  ): number[] {
    if (data.length === 0)
      return Array.from({ length: target }, () => defaultValue);
    const result: number[] = [],
      step = data.length / target;
    for (let i = 0; i < target; i++) {
      const start = Math.floor(i * step),
        end = Math.floor((i + 1) * step);
      let sum = 0;
      for (let j = start; j < end; j++) sum += data[j] ?? defaultValue;
      result.push(
        end > start ? sum / (end - start) : (data[start] ?? defaultValue),
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
