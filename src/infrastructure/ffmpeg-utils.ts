import { spawn } from 'child_process';
import { getFFmpegEnv } from './ffmpeg-env.ts';
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
 * [SECURITY] Demuxers FFmpeg may pick for library media and thumbnails.
 * Playlist and manifest demuxers (dash, hls, concat, ...) are left out on
 * purpose: they open further URLs named inside the file, so a crafted "video"
 * could make the host send requests to the LAN or cloud metadata endpoints.
 * The dash demuxer opens those URLs without honouring -protocol_whitelist, so
 * only this allow-list stops it.
 */
const FFMPEG_ALLOWED_DEMUXERS = [
  // Video containers (misnamed files are probed by content, so be generous)
  'mov',
  'matroska',
  'avi',
  'asf',
  'flv',
  'ogg',
  'mpegts',
  'mpeg',
  'mpegvideo',
  'm4v',
  'h264',
  'hevc',
  'rm',
  'nut',
  'mxf',
  'dv',
  'ivf',
  'obu',
  // Audio-only files
  'mp3',
  'aac',
  'wav',
  'w64',
  'flac',
  'aiff',
  'ac3',
  'eac3',
  'caf',
  // Images (thumbnail generation)
  'image2',
  'jpeg_pipe',
  'png_pipe',
  'apng',
  'gif',
  'gif_pipe',
  'webp_pipe',
  'bmp_pipe',
  'tiff_pipe',
  'svg_pipe',
].join(',');

/**
 * [SECURITY] Input options that confine what FFmpeg may open while reading
 * `input`. Local files may only use the file protocol; Drive media is read
 * through the internal HTTP proxy (http://127.0.0.1), which needs http + tcp.
 * URL inputs also get {@link FFMPEG_URL_INPUT_ARGS}. Must be placed directly
 * before the matching `-i`.
 */
export function getInputSafetyArgs(input: string): string[] {
  const isUrl = /^http:\/\//i.test(input);
  return [
    '-protocol_whitelist',
    isUrl ? 'http,tcp' : 'file',
    '-format_whitelist',
    FFMPEG_ALLOWED_DEMUXERS,
    ...(isUrl ? FFMPEG_URL_INPUT_ARGS : []),
  ];
}

/**
 * Network options for URL inputs (the internal Drive proxy). The proxy ends
 * or resets the response when Drive fails and has its own 60 s stall
 * watchdog; these are defence in depth on the ffmpeg side:
 * - `-rw_timeout` (in microseconds, set above the proxy watchdog so that one
 *   reports the stall first) fails a read that gets no data at all, instead
 *   of blocking forever.
 * - `-reconnect` resumes with a Range request after the connection drops
 *   before EOF (a transient reset), giving up after `-reconnect_delay_max`
 *   seconds of backoff. Connect errors and HTTP errors are not retried, so a
 *   request the proxy refuses still fails at once.
 */
export const FFMPEG_URL_INPUT_ARGS: readonly string[] = [
  '-rw_timeout',
  String(90 * 1_000_000),
  '-reconnect',
  '1',
  '-reconnect_delay_max',
  '5',
];

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
  args.push(...getInputSafetyArgs(inputPath), '-i', inputPath);

  // Output options specific to MP4 streaming
  args.push('-f', 'mp4');
  args.push(...FFMPEG_BASE_CODEC_ARGS);
  args.push('-movflags', 'frag_keyframe+empty_moov');
  args.push('pipe:1');

  return args;
}

/** Thumbnails are downscaled (never upscaled) to at most this width. */
const THUMBNAIL_MAX_WIDTH = 640;

/**
 * @param seekSeconds Input seek position. Use 0 for images and clips too
 * short to have a frame at the default position: seeking past the end makes
 * FFmpeg exit 0 without writing anything.
 */
export function getThumbnailArgs(
  filePath: string,
  cacheFile: string,
  seekSeconds = 1,
): string[] {
  return [
    ...FFMPEG_COMMON_ARGS,
    '-y',
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    ...getInputSafetyArgs(filePath),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    `scale='min(${THUMBNAIL_MAX_WIDTH},iw)':-2`,
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
 * @param signal - Kills the process when aborted; it then resolves with code null.
 * @returns Promise resolving to { code, stdout, stderr }.
 * @throws Error if process fails or times out.
 */
export async function runFFmpeg(
  command: string,
  args: string[],
  timeoutMs = 30000,
  signal?: AbortSignal,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let proc;
    try {
      // windowsHide: a console-subsystem ffmpeg.exe started from the GUI app
      // would otherwise flash its own console window.
      proc = spawn(command, args, { windowsHide: true, env: getFFmpegEnv() });
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)));
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      if (proc) proc.kill('SIGKILL');
      reject(new Error(`Process timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const child = proc;
    const onAbort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      if (!timedOut) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    // 'close' (not 'exit'): stdout/stderr may still hold unread output when
    // 'exit' fires, which would truncate the probe results parsed below.
    proc.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
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
    const [, h = '0', m = '0', s = '0'] = match;
    const hours = parseFloat(h);
    const minutes = parseFloat(m);
    const seconds = parseFloat(s);
    return hours * 3600 + minutes * 60 + seconds;
  }
  return null;
}

export async function getFFmpegDuration(
  filePath: string,
  ffmpegPath: string,
): Promise<number> {
  try {
    const { stderr } = await runFFmpeg(ffmpegPath, [
      ...getInputSafetyArgs(filePath),
      '-i',
      filePath,
    ]);
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
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
  /** Container duration in seconds, when FFmpeg reports one. */
  duration?: number | undefined;
}> {
  const { stderr } = await runFFmpeg(ffmpegPath, [
    ...getInputSafetyArgs(filePath),
    '-i',
    filePath,
  ]);
  // FFmpeg typically outputs stream info to stderr
  const hasVideo = /Stream #\d+:\d+(?:.*): Video:/.test(stderr);
  const hasAudio = /Stream #\d+:\d+(?:.*): Audio:/.test(stderr);

  const videoMatch = stderr.match(
    /Stream #\d+:\d+(?:.*): Video:\s*([a-zA-Z0-9_-]+)/,
  );
  const audioMatch = stderr.match(
    /Stream #\d+:\d+(?:.*): Audio:\s*([a-zA-Z0-9_-]+)/,
  );

  const duration = parseFFmpegDuration(stderr);

  return {
    hasVideo,
    hasAudio,
    videoCodec: videoMatch ? videoMatch[1] : undefined,
    audioCodec: audioMatch ? audioMatch[1] : undefined,
    ...(duration !== null && duration > 0 ? { duration } : {}),
  };
}

export function canStreamCopy(
  videoCodec?: string,
  audioCodec?: string,
): { copyVideo: boolean; copyAudio: boolean } {
  const copyVideo = videoCodec === 'h264';
  const copyAudio = audioCodec === 'aac' || audioCodec === 'mp3';
  return { copyVideo, copyAudio };
}

export function getHlsTranscodeArgs(
  inputPath: string,
  outputSegmentPath: string,
  outputPlaylistPath: string,
  segmentDuration: number,
  options: {
    copyVideo?: boolean;
    copyAudio?: boolean;
    preset?: string;
    crf?: string;
    threads?: string;
    /** HLS key info file: segments are then encrypted with AES-128. */
    keyInfoPath?: string;
  } = {},
): string[] {
  const {
    copyVideo = false,
    copyAudio = false,
    preset = FFMPEG_TRANSCODE_PRESET,
    crf = FFMPEG_TRANSCODE_CRF,
    threads = '2',
    keyInfoPath,
  } = options;

  const args = [
    ...FFMPEG_COMMON_ARGS,
    // -loglevel error hides the progress line; -stats prints it anyway so
    // HlsManager can report time/fps/speed while the transcode runs.
    '-stats',
    ...FFMPEG_INPUT_OPTIONS,
    ...getInputSafetyArgs(inputPath),
    '-i',
    inputPath,
    '-c:v',
    copyVideo ? 'copy' : 'libx264',
    '-c:a',
    copyAudio ? 'copy' : 'aac',
  ];

  if (!copyVideo) {
    args.push(
      '-preset',
      preset,
      '-pix_fmt',
      'yuv420p',
      '-crf',
      crf,
      '-threads',
      threads,
    );
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
    // EVENT playlist: segments are only ever appended, so players start at the
    // beginning, and ffmpeg writes #EXT-X-ENDLIST when the transcode finishes.
    '-hls_playlist_type',
    'event',
    ...(keyInfoPath ? ['-hls_key_info_file', keyInfoPath] : []),
    '-hls_segment_filename',
    outputSegmentPath,
    outputPlaylistPath,
  );

  return args;
}
