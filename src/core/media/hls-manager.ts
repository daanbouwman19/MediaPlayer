import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import {
  getHlsTranscodeArgs,
  getFFmpegStreams,
  canStreamCopy,
} from '../../infrastructure/ffmpeg-utils.ts';
import { createMediaSource } from './media-source.ts';
import { isDrivePath } from './media-utils.ts';
import {
  HLS_SEGMENT_DURATION,
  MAX_CONCURRENT_TRANSCODES,
} from './constants.ts';
import { getFFmpegStaticPath } from '../../infrastructure/ffmpeg-static-path';

export interface HlsProgress {
  currentTime: number; // in seconds
  duration: number; // in seconds
  percent: number;
  fps: number;
  speed: string;
}

/**
 * Lifecycle of an HLS session. Every session starts in STARTING and ends in
 * exactly one terminal status, which never changes afterwards:
 *
 *   STARTING --playlist written--> ACTIVE --ffmpeg exited with 0--> COMPLETE
 *   STARTING/ACTIVE --ffmpeg failed, or was killed by someone else--> ERROR
 *   STARTING/ACTIVE --stopSession / idle eviction / stopAll--> STOPPED
 *
 * COMPLETE sessions are reused by later requests. COMPLETE and ERROR sessions
 * stay in memory until they are evicted or replaced; STOPPED sessions have
 * already been removed.
 */
export enum HlsSessionStatus {
  STARTING = 'starting',
  ACTIVE = 'active',
  ERROR = 'error',
  STOPPED = 'stopped',
  COMPLETE = 'complete',
}

type TerminalStatus =
  | HlsSessionStatus.COMPLETE
  | HlsSessionStatus.ERROR
  | HlsSessionStatus.STOPPED;

/** Thrown by ensureSession when the interactive transcode budget is used up. */
export class HlsBusyError extends Error {
  readonly code = 'HLS_BUSY';

  constructor() {
    super('Server too busy. Please try again later.');
    this.name = 'HlsBusyError';
  }
}

interface HlsSession {
  id: string;
  outputDir: string;
  playlistPath: string;
  status: HlsSessionStatus;
  error?: Error;
  progress: HlsProgress;
  lastAccess: number;
  /** HTTP requests currently being served from this session. */
  consumers: number;
  idleTimer?: NodeJS.Timeout | undefined;
  /**
   * A player request that runs ffmpeg, so it counts against the concurrency
   * cap (a request for a retained output only once that proves unusable).
   */
  interactive: boolean;
  /** Finished pre-transcode whose output stays on disk after eviction. */
  retained: boolean;
  /** This session (re)created the output directory, so it owns its contents. */
  wroteOutput: boolean;
  process: ChildProcess | null;
  /** True once the ffmpeg process has gone away (or when there is none). */
  exited: boolean;
  /** Resolves when the ffmpeg process has gone away. */
  exit: Promise<void>;
  /** Settles when startup (probe, spawn, first playlist) is over. */
  ready: Promise<void>;
  /** Resolves with the terminal status. */
  finished: Promise<TerminalStatus>;
  settle: (status: TerminalStatus) => void;
  /** Last stderr lines that were not progress reports, i.e. ffmpeg errors. */
  stderrTail: string[];
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const EAGER_IDLE_GRACE_MS = 30 * 1000;
/**
 * hls.js refreshes a live playlist about once per segment, so a session that
 * has not been fetched from for this long has no viewer left.
 */
const IDLE_EVICTION_MS = 3 * HLS_SEGMENT_DURATION * 1000;
const PLAYLIST_TIMEOUT_MS = 10_000;
const PLAYLIST_POLL_MS = 500;
/** SIGTERM first, SIGKILL if ffmpeg is still alive after this long. */
const KILL_ESCALATION_MS = 2000;
/** Upper bound for waiting on a killed ffmpeg before touching its directory. */
const EXIT_WAIT_MS = 5000;
const STDERR_TAIL_LINES = 5;
/** Marks an output directory as a finished pre-transcode to keep. */
const RETAIN_MARKER = '.retained';
const PLAYLIST_NAME = 'playlist.m3u8';

function isTerminal(status: HlsSessionStatus): boolean {
  return (
    status === HlsSessionStatus.COMPLETE ||
    status === HlsSessionStatus.ERROR ||
    status === HlsSessionStatus.STOPPED
  );
}

function isLive(status: HlsSessionStatus): boolean {
  return (
    status === HlsSessionStatus.STARTING || status === HlsSessionStatus.ACTIVE
  );
}

/** Waits for `promise`, but gives up after `ms`. */
async function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sum of the #EXTINF segment durations in a playlist, in seconds. */
function playlistDuration(playlist: string): number {
  let total = 0;
  for (const match of playlist.matchAll(/#EXTINF:([\d.]+)/g)) {
    total += parseFloat(match[1] ?? '0');
  }
  return total;
}

/**
 * The source file a retained output was transcoded from, stored in its
 * marker. Output is keyed by path only, so a file replaced at the same path
 * (or a new revision of a Drive file) must not reuse the old transcode.
 */
interface SourceIdentity {
  size: number;
  /** Local files only; Drive files are compared by size. */
  mtimeMs?: number;
}

async function readSourceIdentity(filePath: string): Promise<SourceIdentity> {
  const size = await createMediaSource(filePath).getSize();
  if (isDrivePath(filePath)) return { size };
  const { mtimeMs } = await fs.stat(filePath);
  return { size, mtimeMs };
}

/** Parses a marker written by retainSession; null when it is not one. */
function parseSourceIdentity(marker: string): SourceIdentity | null {
  let value: unknown;
  try {
    value = JSON.parse(marker);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  if (!('size' in value) || typeof value.size !== 'number') return null;
  if (!('mtimeMs' in value)) return { size: value.size };
  return typeof value.mtimeMs === 'number'
    ? { size: value.size, mtimeMs: value.mtimeMs }
    : null;
}

function isSameSource(a: SourceIdentity, b: SourceIdentity): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs;
}

interface RetainedOutput {
  playlist: string;
  source: SourceIdentity;
}

/**
 * Returns the finished, retained pre-transcode in `dir`, or null when the
 * directory holds anything else.
 */
async function readRetainedOutput(dir: string): Promise<RetainedOutput | null> {
  let marker: string;
  let playlist: string;
  try {
    marker = await fs.readFile(path.join(dir, RETAIN_MARKER), 'utf8');
    playlist = await fs.readFile(path.join(dir, PLAYLIST_NAME), 'utf8');
  } catch {
    return null;
  }
  const source = parseSourceIdentity(marker);
  if (!source || !playlist.includes('#EXT-X-ENDLIST')) return null;
  return { playlist, source };
}

export class HlsManager extends EventEmitter {
  private static instance: HlsManager | null = null;
  private sessions: Map<string, HlsSession> = new Map();
  /** Exit promises of killed ffmpeg processes that have not exited yet. */
  private exiting: Map<string, Promise<void>> = new Map();
  /** Output directory deletions that have not finished yet, by session id. */
  private discarding: Map<string, Promise<void>> = new Map();
  private pinnedSessions: Set<string> = new Set();
  /**
   * Ids whose directory holds a retained pre-transcode, known synchronously:
   * playing one needs no ffmpeg, so the request skips the transcode cap.
   */
  private retainedIds: Set<string> = new Set();
  private cacheDir: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  /** Set by stopAll(): no new sessions start during shutdown. */
  private closed = false;

  private constructor() {
    super();
  }

  public static resetInstance() {
    const instance = HlsManager.instance;
    if (!instance) return;
    instance.stopCleanupInterval();
    for (const s of instance.sessions.values()) {
      if (s.idleTimer) {
        clearTimeout(s.idleTimer);
      }
      if (s.process && !s.exited) {
        try {
          s.process.kill('SIGKILL');
        } catch {
          // Ignore errors during reset
        }
      }
    }
    instance.sessions.clear();
    instance.exiting.clear();
    instance.discarding.clear();
    instance.pinnedSessions.clear();
    instance.retainedIds.clear();
    instance.removeAllListeners();
    HlsManager.instance = null;
  }

  static getInstance(): HlsManager {
    if (!HlsManager.instance) {
      HlsManager.instance = new HlsManager();
    }
    return HlsManager.instance;
  }

  /**
   * Prepares the cache directory at startup: deletes output left behind by an
   * earlier run (partial transcodes, sessions that were never cleaned up) and
   * keeps finished pre-transcodes.
   */
  async init(cacheDir?: string) {
    if (cacheDir) {
      this.cacheDir = cacheDir;
    }
    await this.cleanupOrphanedSessions();
  }

  setCacheDir(dir: string) {
    this.cacheDir = dir;
  }

  /** Pinned sessions keep transcoding without a viewer (background jobs). */
  pinSession(id: string) {
    this.pinnedSessions.add(id);
  }

  unpinSession(id: string) {
    this.pinnedSessions.delete(id);
  }

  /**
   * Keeps the output of a complete session on disk after it leaves memory, so
   * later playback (also after a restart) reuses it instead of transcoding
   * again, for as long as `filePath` is unchanged. Returns false when the
   * session is not complete.
   */
  async retainSession(sessionId: string, filePath: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== HlsSessionStatus.COMPLETE) return false;
    if (session.retained) return true;
    const source = await readSourceIdentity(filePath);
    // Stopped (for example by Clear HLS) while the source was read.
    if (this.sessions.get(sessionId) !== session) return false;
    // Set first so an eviction during the write keeps the directory.
    session.retained = true;
    this.retainedIds.add(sessionId);
    try {
      await fs.writeFile(
        path.join(session.outputDir, RETAIN_MARKER),
        JSON.stringify(source),
      );
    } catch (err) {
      session.retained = false;
      this.retainedIds.delete(sessionId);
      throw err;
    }
    return true;
  }

  /**
   * Resolves with the terminal status of the current session for `sessionId`
   * (STOPPED when there is none), including when it is stopped or cancelled.
   */
  waitForSession(sessionId: string): Promise<HlsSessionStatus> {
    const session = this.sessions.get(sessionId);
    return session
      ? session.finished
      : Promise.resolve(HlsSessionStatus.STOPPED);
  }

  async ensureSession(sessionId: string, filePath: string): Promise<string> {
    return this.ensureSessionInternal(sessionId, filePath, true);
  }

  async ensureSessionUnthrottled(
    sessionId: string,
    filePath: string,
  ): Promise<string> {
    return this.ensureSessionInternal(sessionId, filePath, false);
  }

  /**
   * Shared implementation for ensureSession (throttled) and
   * ensureSessionUnthrottled. The only functional difference is the
   * concurrency cap, which is applied when `throttle` is true.
   */
  private async ensureSessionInternal(
    sessionId: string,
    filePath: string,
    throttle: boolean,
  ): Promise<string> {
    if (!this.cacheDir) {
      throw new Error('HlsManager: cacheDir not set');
    }

    let session = this.sessions.get(sessionId);
    if (!session || session.status === HlsSessionStatus.ERROR) {
      if (this.closed) {
        throw new Error('HlsManager: shutting down');
      }
      // Playing a retained pre-transcode needs no ffmpeg, so it does not wait
      // for a transcode slot; startSession applies the cap if the output
      // turns out to be unusable.
      const deferCap = throttle && this.retainedIds.has(sessionId);
      if (throttle && !deferCap) {
        this.makeRoomForInteractiveSession();
      }
      // A failed transcode is retried from scratch.
      if (session) {
        this.detach(session);
      }
      // The new session is in the map before the first await, so parallel
      // requests join it and the cap check above sees it.
      session = this.createSession(
        sessionId,
        this.cacheDir,
        throttle && !deferCap,
      );
      session.ready = this.startSession(session, filePath, deferCap);
    }

    session.lastAccess = Date.now();
    await session.ready;
    if (this.sessions.get(sessionId) !== session) {
      throw new Error('HLS session was stopped');
    }
    return session.playlistPath;
  }

  /**
   * [SECURITY] Caps concurrent interactive transcodes (CPU DoS protection).
   * Only unpinned player sessions whose ffmpeg is still starting or running
   * count; finished sessions and background pre-transcodes do not. At the cap,
   * sessions nobody has fetched from recently are evicted (least recently used
   * first) before the request is refused.
   */
  private makeRoomForInteractiveSession(): void {
    const running: HlsSession[] = [];
    for (const s of this.sessions.values()) {
      if (s.interactive && isLive(s.status) && !this.pinnedSessions.has(s.id)) {
        running.push(s);
      }
    }
    const needed = running.length - MAX_CONCURRENT_TRANSCODES + 1;
    if (needed <= 0) return;

    const now = Date.now();
    const idle = running
      .filter(
        (s) =>
          s.status === HlsSessionStatus.ACTIVE &&
          s.consumers === 0 &&
          now - s.lastAccess >= IDLE_EVICTION_MS,
      )
      .sort((a, b) => a.lastAccess - b.lastAccess);
    if (idle.length < needed) {
      throw new HlsBusyError();
    }
    for (const s of idle.slice(0, needed)) {
      void this.evict(s);
    }
  }

  private createSession(
    id: string,
    cacheDir: string,
    interactive: boolean,
  ): HlsSession {
    const outputDir = path.join(cacheDir, id);
    let settle!: (status: TerminalStatus) => void;
    const finished = new Promise<TerminalStatus>((resolve) => {
      settle = resolve;
    });
    const session: HlsSession = {
      id,
      outputDir,
      playlistPath: path.join(outputDir, PLAYLIST_NAME),
      status: HlsSessionStatus.STARTING,
      progress: {
        currentTime: 0,
        duration: 0,
        percent: 0,
        fps: 0,
        speed: '0x',
      },
      lastAccess: Date.now(),
      consumers: 0,
      interactive,
      retained: false,
      wroteOutput: false,
      process: null,
      exited: true,
      exit: Promise.resolve(),
      ready: Promise.resolve(),
      finished,
      settle,
      stderrTail: [],
    };
    this.sessions.set(id, session);
    this.startCleanupInterval();
    return session;
  }

  /**
   * Adopts a retained output or transcodes `filePath`. `capDeferred`: the
   * transcode cap was skipped for a presumed retained output, so it applies
   * here if that output is unusable (the session does not count against the
   * cap until then).
   */
  private async startSession(
    session: HlsSession,
    filePath: string,
    capDeferred: boolean,
  ) {
    try {
      // A killed ffmpeg for the same file may still be writing to this
      // directory, or an earlier session's output may still be being deleted.
      await this.waitForExitOf(session.id);
      this.assertStarting(session);
      if (await this.adoptRetainedOutput(session, filePath)) return;
      this.assertStarting(session);
      // Whatever is on disk is not a usable pre-transcode; it is replaced.
      this.retainedIds.delete(session.id);
      if (capDeferred) {
        this.makeRoomForInteractiveSession();
        session.interactive = true;
      }

      session.wroteOutput = true;
      await fs.rm(session.outputDir, { recursive: true, force: true });
      await fs.mkdir(session.outputDir, { recursive: true });

      const ffmpegPath = getFFmpegStaticPath();
      if (!ffmpegPath) throw new Error('FFmpeg not found');

      const mediaSource = createMediaSource(filePath);
      const ffmpegInput = await mediaSource.getFFmpegInput();
      const streamsInfo = await getFFmpegStreams(ffmpegInput, ffmpegPath);
      this.assertStarting(session);
      // ffmpeg runs with -loglevel error and never prints the duration itself.
      if (streamsInfo.duration) {
        session.progress.duration = streamsInfo.duration;
      }

      const { copyVideo, copyAudio } = canStreamCopy(
        streamsInfo.videoCodec,
        streamsInfo.audioCodec,
      );

      const args = getHlsTranscodeArgs(
        ffmpegInput,
        path.join(session.outputDir, 'seg-%03d.ts'),
        session.playlistPath,
        HLS_SEGMENT_DURATION,
        { copyVideo, copyAudio },
      );

      this.attachProcess(
        session,
        spawn(ffmpegPath, args, {
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        }),
      );

      await this.waitForPlaylist(session);
      // Short or stream-copied files can finish before the playlist poll
      // notices them: never overwrite a terminal status with ACTIVE.
      if (session.status === HlsSessionStatus.STARTING) {
        this.setStatus(session, HlsSessionStatus.ACTIVE);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.finish(session, HlsSessionStatus.ERROR, error);
      this.detach(session);
      // Leave nothing half-written behind (a retained output is never
      // touched here, because it is adopted before wroteOutput is set).
      // Runs once ffmpeg has exited; the caller need not wait for that.
      if (session.wroteOutput) {
        void this.discardOutput(session);
      }
      throw error;
    }
  }

  /** Throws when the session was stopped while it was starting. */
  private assertStarting(session: HlsSession) {
    if (session.status !== HlsSessionStatus.STARTING) {
      throw new Error('HLS session was stopped');
    }
  }

  /**
   * Reuses a finished pre-transcode left on disk (for example by an earlier
   * run) instead of transcoding the file again, unless the file at
   * `filePath` has changed since it was transcoded.
   */
  private async adoptRetainedOutput(
    session: HlsSession,
    filePath: string,
  ): Promise<boolean> {
    const retained = await readRetainedOutput(session.outputDir);
    if (!retained) return false;
    // A source that cannot be read cannot be transcoded either: fail without
    // deleting the output, which may still be valid.
    const source = await readSourceIdentity(filePath);
    if (!isSameSource(retained.source, source)) return false;
    this.assertStarting(session);
    session.retained = true;
    this.retainedIds.add(session.id);
    session.progress.duration = playlistDuration(retained.playlist);
    this.finish(session, HlsSessionStatus.COMPLETE);
    return true;
  }

  private attachProcess(session: HlsSession, proc: ChildProcess) {
    session.process = proc;
    session.exited = false;
    // Every handler closes over its own session object, so a late event from
    // an old process can never touch a newer session for the same file.
    session.exit = new Promise<void>((resolve) => {
      // 'close' also follows a failed spawn, and comes after stderr is drained.
      proc.once(
        'close',
        (code: number | null, signal: NodeJS.Signals | null) => {
          session.exited = true;
          session.process = null;
          resolve();
          this.onProcessClose(session, code, signal);
        },
      );
    });

    let stderrBuffer = '';
    proc.stderr?.on('data', (data: Buffer) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split(/[\r\n]+/);
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        this.parseStderrLine(session, line);
      }
    });

    proc.on('error', (err) => {
      this.finish(session, HlsSessionStatus.ERROR, err);
    });
  }

  private onProcessClose(
    session: HlsSession,
    code: number | null,
    signal: NodeJS.Signals | null,
  ) {
    // A stopped session expects its process to die.
    if (isTerminal(session.status)) return;

    if (code === 0) {
      this.finish(session, HlsSessionStatus.COMPLETE);
      return;
    }

    // Any other exit is a failure, including a signal this manager did not
    // send (for example SIGKILL from the OOM killer): the output is truncated.
    const reason = signal
      ? `was killed by ${signal}`
      : `exited with code ${code}`;
    const details = session.stderrTail.join(' | ');
    const message = `FFmpeg ${reason}${details ? `: ${details}` : ''}`;
    console.error(`[HLS] Session ${session.id}: ${message}`);
    this.finish(session, HlsSessionStatus.ERROR, new Error(message));
  }

  private parseStderrLine(session: HlsSession, line: string) {
    // With -loglevel error, every line that is not a -stats progress report
    // is an error message; keep the last few for the failure reason.
    if (!/\btime=/.test(line)) {
      const text = line.trim();
      if (text) {
        session.stderrTail.push(text);
        if (session.stderrTail.length > STDERR_TAIL_LINES) {
          session.stderrTail.shift();
        }
      }
      return;
    }

    const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
    if (timeMatch) {
      const [, hh = '0', mm = '0', ss = '0', frac = '0'] = timeMatch;
      const h = parseInt(hh, 10);
      const m = parseInt(mm, 10);
      const s = parseFloat(`${ss}.${frac}`);
      session.progress.currentTime = h * 3600 + m * 60 + s;

      if (session.progress.duration > 0) {
        session.progress.percent = Math.min(
          100,
          Math.floor(
            (session.progress.currentTime / session.progress.duration) * 100,
          ),
        );
      }
    }

    const fpsMatch = line.match(/fps=\s*(\d+)/);
    if (fpsMatch?.[1]) {
      session.progress.fps = parseInt(fpsMatch[1], 10);
    }

    const speedMatch = line.match(/speed=\s*(\d+\.?\d*x)/);
    if (speedMatch?.[1]) {
      session.progress.speed = speedMatch[1];
    }
  }

  /**
   * Resolves once ffmpeg has written a non-empty playlist. ffmpeg logs only
   * errors, so the file is polled; the session ending first settles it too.
   */
  private waitForPlaylist(session: HlsSession): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;
      let poll: NodeJS.Timeout | undefined;

      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        clearInterval(poll);
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      const playlistReady = async () => {
        try {
          const stats = await fs.stat(session.playlistPath);
          return stats.size > 0;
        } catch {
          return false; // not written yet
        }
      };

      const check = () => {
        void playlistReady().then((ready) => {
          if (ready) settle();
        });
      };

      timeout = setTimeout(() => {
        settle(new Error('Timeout waiting for HLS playlist'));
      }, PLAYLIST_TIMEOUT_MS);
      poll = setInterval(check, PLAYLIST_POLL_MS);

      void session.finished.then(async (status) => {
        if (status === HlsSessionStatus.COMPLETE) {
          // Finished between two polls: check one last time.
          if (await playlistReady()) {
            settle();
          } else {
            settle(new Error('HLS session finished but playlist not found'));
          }
        } else if (status === HlsSessionStatus.ERROR) {
          settle(
            session.error ||
              new Error('HLS session failed before playlist ready'),
          );
        } else {
          settle(new Error('HLS session was stopped'));
        }
      });

      check();
    });
  }

  private setStatus(session: HlsSession, status: HlsSessionStatus) {
    session.status = status;
    this.emit(`status:${session.id}`, status);
  }

  /**
   * Moves a session to a terminal status exactly once: records why, stops its
   * ffmpeg if it is still running and settles everyone waiting on it. Calls
   * for a session that has already finished are ignored.
   */
  private finish(
    session: HlsSession,
    status: TerminalStatus,
    error?: Error,
  ): void {
    if (isTerminal(session.status)) return;
    if (error) {
      session.error = error;
    }
    if (status === HlsSessionStatus.COMPLETE) {
      session.progress.percent = 100;
      if (session.progress.duration > 0) {
        session.progress.currentTime = session.progress.duration;
      }
    }
    this.clearIdleTimer(session);
    this.killProcess(session);
    this.setStatus(session, status);
    session.settle(status);
  }

  /** SIGTERM, then SIGKILL if ffmpeg has not exited in time. */
  private killProcess(session: HlsSession) {
    const proc = session.process;
    if (!proc || session.exited) return;
    try {
      proc.kill('SIGTERM');
    } catch {
      // Already gone
    }
    // proc.killed turns true as soon as a signal is sent, so escalate on the
    // real exit instead.
    const escalation = setTimeout(() => {
      if (!session.exited) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Already gone
        }
      }
    }, KILL_ESCALATION_MS);
    escalation.unref();

    const exit = session.exit;
    this.exiting.set(session.id, exit);
    void exit.then(() => {
      clearTimeout(escalation);
      if (this.exiting.get(session.id) === exit) {
        this.exiting.delete(session.id);
      }
    });
  }

  private async waitForExitOf(sessionId: string) {
    const exit = this.exiting.get(sessionId);
    if (exit) {
      await waitAtMost(exit, EXIT_WAIT_MS);
    }
    const removal = this.discarding.get(sessionId);
    if (removal) {
      await removal;
    }
  }

  /**
   * Deletes a session directory, tracked so that a new session for the same
   * id waits for it instead of racing it with its own rm and mkdir.
   */
  private removeOutputDir(sessionId: string, dir: string): Promise<void> {
    const removal = fs
      .rm(dir, { recursive: true, force: true })
      .catch((err: unknown) => {
        console.error(`[HLS] Failed to clean up ${dir}:`, err);
      });
    this.discarding.set(sessionId, removal);
    void removal.then(() => {
      if (this.discarding.get(sessionId) === removal) {
        this.discarding.delete(sessionId);
      }
    });
    return removal;
  }

  private clearIdleTimer(session: HlsSession) {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
  }

  /** Removes a session from memory, stopping it first if it still runs. */
  private detach(session: HlsSession) {
    this.finish(session, HlsSessionStatus.STOPPED);
    this.clearIdleTimer(session);
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
    }
    if (this.sessions.size === 0) {
      this.stopCleanupInterval();
    }
  }

  /**
   * Deletes a detached session's output once its ffmpeg has exited, unless a
   * newer session for the same file owns the directory by then.
   */
  private async discardOutput(session: HlsSession) {
    if (!session.exited) {
      await waitAtMost(session.exit, EXIT_WAIT_MS);
    }
    if (this.sessions.has(session.id)) return;
    this.retainedIds.delete(session.id);
    await this.removeOutputDir(session.id, session.outputDir);
  }

  /**
   * Drops an idle session (or every session at shutdown). The output is kept
   * only for finished, retained pre-transcodes and for sessions that never
   * wrote to their directory.
   */
  private async evict(session: HlsSession) {
    const keepOutput =
      !session.wroteOutput ||
      (session.retained && session.status === HlsSessionStatus.COMPLETE);
    this.detach(session);
    if (!keepOutput) {
      await this.discardOutput(session);
    }
  }

  getSessionDir(sessionId: string) {
    if (!this.cacheDir) return null;
    return path.join(this.cacheDir, sessionId);
  }

  getSessionProgress(sessionId: string): HlsProgress | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.progress;
  }

  touchSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccess = Date.now();
    }
  }

  acquireSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.consumers++;
    this.clearIdleTimer(session);
    session.lastAccess = Date.now();
  }

  releaseSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.consumers > 0) {
      session.consumers--;
    }
    if (session.consumers > 0) return;
    if (this.pinnedSessions.has(sessionId)) return;
    // Only a running ffmpeg is worth stopping early; finished sessions are
    // left to the periodic sweep so a paused viewer keeps its segments.
    if (!isLive(session.status)) return;
    this.clearIdleTimer(session);
    session.idleTimer = setTimeout(() => {
      session.idleTimer = undefined;
      if (this.sessions.get(sessionId) !== session) return;
      if (session.consumers > 0) return;
      if (this.pinnedSessions.has(sessionId)) return;
      if (!isLive(session.status)) return;
      void this.evict(session);
    }, EAGER_IDLE_GRACE_MS);
    session.idleTimer.unref();
  }

  /**
   * Stops the session for `sessionId` and deletes its output, including a
   * retained pre-transcode that is only on disk.
   */
  async stopSession(sessionId: string) {
    this.pinnedSessions.delete(sessionId);
    this.retainedIds.delete(sessionId);
    const session = this.sessions.get(sessionId);
    if (session) {
      this.detach(session);
      await this.discardOutput(session);
      return;
    }

    const dir = this.getSessionDir(sessionId);
    if (!dir) return;
    await this.waitForExitOf(sessionId);
    if (this.sessions.has(sessionId)) return;
    await this.removeOutputDir(sessionId, dir);
  }

  /**
   * Shutdown: stops every session, deletes unfinished output and waits
   * (bounded) until all ffmpeg processes have exited. No session can be
   * started afterwards.
   */
  async stopAll() {
    this.closed = true;
    this.stopCleanupInterval();
    this.pinnedSessions.clear();
    const sessions = [...this.sessions.values()];
    const lingering = [...this.exiting.values()];
    await Promise.all([
      ...sessions.map((s) => this.evict(s)),
      ...lingering.map((exit) => waitAtMost(exit, EXIT_WAIT_MS)),
      ...this.discarding.values(),
    ]);
  }

  private startCleanupInterval() {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        void this.cleanup();
      }, CLEANUP_INTERVAL_MS);
      this.cleanupInterval.unref();
    }
  }

  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async cleanup() {
    const now = Date.now();
    // Deleting the current entry while iterating a Map is safe.
    for (const session of this.sessions.values()) {
      if (this.pinnedSessions.has(session.id)) continue;
      if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
        await this.evict(session);
      }
    }
  }

  private async cleanupOrphanedSessions() {
    if (!this.cacheDir) return;
    try {
      const dirs = await fs.readdir(this.cacheDir);
      for (const dir of dirs) {
        const fullPath = path.join(this.cacheDir, dir);
        const stats = await fs.stat(fullPath);
        if (!stats.isDirectory() || this.sessions.has(dir)) continue;
        // Whether the source is unchanged is checked when it is played.
        if ((await readRetainedOutput(fullPath)) !== null) {
          this.retainedIds.add(dir);
          continue;
        }
        if (this.sessions.has(dir)) continue;
        console.log(`[HLS] Cleaning up orphaned session directory: ${dir}`);
        await this.removeOutputDir(dir, fullPath);
      }
    } catch (err) {
      // No cache directory yet (first run): nothing to clean up.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      console.error('[HLS] Startup cleanup failed:', err);
    }
  }
}
