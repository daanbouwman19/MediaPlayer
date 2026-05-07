import { spawn } from 'child_process';
const FFMPEG_TRANSCODE_PRESET = 'ultrafast';
const FFMPEG_TRANSCODE_CRF = '23';

/**
 * Standard FFmpeg input options for probing and analysis.
 */
const FFMPEG_INPUT_OPTIONS = ['-analyzeduration', '100M', '-probesize', '100M'];

/**
 * Common logging and banner options.
 */
const FFMPEG_COMMON_ARGS = ['-hide_banner', '-loglevel', 'error'];

/**
 * Standard base codec arguments for H.264/AAC transcoding.
 * Used for both direct streaming (MP4) and HLS.
 */
const FFMPEG_BASE_CODEC_ARGS = [
  '-c:v',
  'libx264',
  '-c:a',
  'aac',
  '-preset',
  FFMPEG_TRANSCODE_PRESET,
  '-crf',
  FFMPEG_TRANSCODE_CRF,
  '-pix_fmt',
  'yuv420p',
];

let cachedCapabilities: {
  supportedVideoCodecs: string[];
  hasNVENC: boolean;
  hasVideoToolbox: boolean;
  hasVAAPI: boolean;
} | null = null;

export async function detectFFmpegCapabilities(
  ffmpegPath: string,
): Promise<typeof cachedCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  try {
    const { stdout, stderr } = await runFFmpeg(ffmpegPath, ['-encoders']);
    const output = stdout || stderr; // FFmpeg sometimes outputs to stderr even for -encoders
    const supportedVideoCodecs = (
      output.match(/[V.][.S][.X][.B][.A][.L]\s+(\w+)/g) || []
    ).map((m) => m.split(/\s+/).pop() || '');

    cachedCapabilities = {
      supportedVideoCodecs,
      hasNVENC: supportedVideoCodecs.includes('h264_nvenc'),
      hasVideoToolbox: supportedVideoCodecs.includes('h264_videotoolbox'),
      hasVAAPI: supportedVideoCodecs.includes('h264_vaapi'),
    };
    return cachedCapabilities;
  } catch (err) {
    console.error('[FFmpeg] Failed to detect capabilities:', err);
    return null;
  }
}

export function getHardwareCodec(
  capabilities: typeof cachedCapabilities,
): string {
  if (!capabilities) return 'libx264';
  if (capabilities.hasNVENC) return 'h264_nvenc';
  if (capabilities.hasVideoToolbox) return 'h264_videotoolbox';
  if (capabilities.hasVAAPI) return 'h264_vaapi';
  return 'libx264';
}

export function isValidTimeFormat(time: string): boolean {
  // Allow simple seconds (e.g., "10", "10.5") or timestamps (e.g., "00:00:10", "00:10.5")
  // [SECURITY] Strictly validate format to prevent ReDoS and invalid FFmpeg arguments.
  // Limit to at most 2 colons (HH:MM:SS format).
  return /^(?:\d+:){0,2}\d+(?:\.\d+)?$/.test(time);
}

export function getTranscodeArgs(
  inputPath: string,
  startTime: string | undefined | null,
): string[] {
  const args: string[] = [...FFMPEG_COMMON_ARGS];

  if (startTime) {
    if (!isValidTimeFormat(startTime)) {
      throw new Error('Invalid start time format');
    }
    args.push('-ss', startTime);
  }

  args.push(...FFMPEG_INPUT_OPTIONS);
  args.push('-i', inputPath);

  // Output options specific to MP4 streaming
  args.push('-f', 'mp4');
  args.push(...FFMPEG_BASE_CODEC_ARGS);
  args.push('-movflags', 'frag_keyframe+empty_moov');
  args.push('pipe:1');

  return args;
}

export function getThumbnailArgs(
  filePath: string,
  cacheFile: string,
): string[] {
  return [
    ...FFMPEG_COMMON_ARGS,
    '-y',
    '-ss',
    '1',
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-q:v',
    '5',
    '-update',
    '1',
    cacheFile,
  ];
}

/**
 * Runs FFmpeg (or any command) with a timeout to prevent hanging processes (DoS).
 *
 * @param command - The command to run (e.g. ffmpeg path).
 * @param args - Arguments for the command.
 * @param timeoutMs - Timeout in milliseconds (default: 30000).
 * @returns Promise resolving to { code, stdout, stderr }.
 * @throws Error if process fails or times out.
 */
export async function runFFmpeg(
  command: string,
  args: string[],
  timeoutMs = 30000,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(command, args);
    } catch (err) {
      return reject(err);
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      if (proc) proc.kill('SIGKILL');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      if (!timedOut) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    proc.on('exit', (code) => {
      if (!timedOut) {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      }
    });
  });
}

export function parseFFmpegDuration(stderr: string): number | null {
  const match = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (match) {
    const hours = parseFloat(match[1]);
    const minutes = parseFloat(match[2]);
    const seconds = parseFloat(match[3]);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

export async function getFFmpegDuration(
  filePath: string,
  ffmpegPath: string,
): Promise<number> {
  try {
    const { stderr } = await runFFmpeg(ffmpegPath, ['-i', filePath]);
    const duration = parseFFmpegDuration(stderr);
    if (duration !== null) {
      return duration;
    } else {
      throw new Error('Could not determine duration');
    }
  } catch (err) {
    if ((err as Error).message === 'Could not determine duration') throw err;
    console.error('[Metadata] FFmpeg spawn error:', err);
    throw new Error('FFmpeg execution failed');
  }
}

export async function getFFmpegStreams(
  filePath: string,
  ffmpegPath: string,
): Promise<{
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
}> {
  const { stderr } = await runFFmpeg(ffmpegPath, ['-i', filePath]);
  // FFmpeg typically outputs stream info to stderr
  const hasVideo = /Stream #\d+:\d+(?:.*): Video:/.test(stderr);
  const hasAudio = /Stream #\d+:\d+(?:.*): Audio:/.test(stderr);

  const videoMatch = stderr.match(
    /Stream #\d+:\d+(?:.*): Video:\s*([a-zA-Z0-9_-]+)/,
  );
  const audioMatch = stderr.match(
    /Stream #\d+:\d+(?:.*): Audio:\s*([a-zA-Z0-9_-]+)/,
  );

  return {
    hasVideo,
    hasAudio,
    videoCodec: videoMatch ? videoMatch[1] : undefined,
    audioCodec: audioMatch ? audioMatch[1] : undefined,
  };
}

export function canStreamCopy(
  videoCodec?: string,
  audioCodec?: string,
): { copyVideo: boolean; copyAudio: boolean } {
  const copyVideo = videoCodec === 'h264' || videoCodec === 'hevc';
  const copyAudio = audioCodec === 'aac' || audioCodec === 'mp3';
  return { copyVideo, copyAudio };
}

export function getHlsTranscodeArgs(
  inputPath: string,
  outputSegmentPath: string,
  outputPlaylistPath: string,
  segmentDuration: number,
  options: {
    hwCodec?: string;
    copyVideo?: boolean;
    copyAudio?: boolean;
    preset?: string;
    crf?: string;
  } = {},
): string[] {
  const {
    hwCodec = 'libx264',
    copyVideo = false,
    copyAudio = false,
    preset = FFMPEG_TRANSCODE_PRESET,
    crf = FFMPEG_TRANSCODE_CRF,
  } = options;

  const args = [
    ...FFMPEG_COMMON_ARGS,
    ...FFMPEG_INPUT_OPTIONS,
    '-i',
    inputPath,
    '-c:v',
    copyVideo ? 'copy' : hwCodec,
    '-c:a',
    copyAudio ? 'copy' : 'aac',
  ];

  if (!copyVideo) {
    args.push('-preset', preset, '-pix_fmt', 'yuv420p');
    if (hwCodec === 'libx264') {
      args.push('-crf', crf, '-threads', '2');
    }
  }

  args.push(
    '-g',
    '48',
    '-sc_threshold',
    '0',
    '-f',
    'hls',
    '-hls_time',
    segmentDuration.toString(),
    '-hls_list_size',
    '0',
    '-hls_segment_filename',
    outputSegmentPath,
    outputPlaylistPath,
  );

  return args;
}
