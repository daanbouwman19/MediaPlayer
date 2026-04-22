import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import PQueue from 'p-queue';
import {
  getHlsTranscodeArgs,
  detectFFmpegCapabilities,
  getHardwareCodec,
  getFFmpegStreams,
} from './utils/ffmpeg-utils.ts';
import { createMediaSource } from './media-source.ts';
import {
  HLS_SEGMENT_DURATION,
  MAX_CONCURRENT_TRANSCODES,
} from './constants.ts';
import { getFFmpegStaticPath } from './utils/ffmpeg-static-path';

export interface HlsProgress {
  currentTime: number; // in seconds
  duration: number; // in seconds
  percent: number;
  fps: number;
  speed: string;
}

export enum HlsSessionStatus {
  STARTING = 'starting',
  ACTIVE = 'active',
  ERROR = 'error',
  STOPPED = 'stopped',
}

interface HlsSession {
  id: string;
  process: ChildProcess | null;
  lastAccess: number;
  outputDir: string;
  playlistPath: string;
  status: HlsSessionStatus;
  error?: Error;
  progress: HlsProgress;
  killTimeout?: NodeJS.Timeout;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity timeout
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute cleanup check

export class HlsManager {
  private static instance: HlsManager | null = null;
  private sessions: Map<string, HlsSession> = new Map();
  private pendingSessions: Map<string, Promise<void>> = new Map();
  private transcodeQueue = new PQueue({
    concurrency: MAX_CONCURRENT_TRANSCODES,
  });
  private cacheDir: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private ffmpegCapabilities: Awaited<
    ReturnType<typeof detectFFmpegCapabilities>
  > | null = null;

  private constructor() {
    this.startCleanupInterval();
  }

  /**
   * Resets the singleton instance for testing purposes.
   */
  public static resetInstance() {
    if (HlsManager.instance) {
      HlsManager.instance.stopCleanupInterval();
      HlsManager.instance.sessions.forEach((s) => {
        if (s.killTimeout) {
          clearTimeout(s.killTimeout);
        }
        if (
          s.process &&
          typeof s.process.kill === 'function' &&
          !s.process.killed
        ) {
          try {
            s.process.kill('SIGKILL');
          } catch {
            // Ignore errors during reset
          }
        }
      });
      HlsManager.instance.sessions.clear();
      HlsManager.instance.pendingSessions.clear();
      HlsManager.instance.transcodeQueue.clear();
      HlsManager.instance = null;
    }
  }

  static getInstance(): HlsManager {
    if (!HlsManager.instance) {
      HlsManager.instance = new HlsManager();
    }
    return HlsManager.instance;
  }

  /**
   * Initializes the manager and cleans up any orphaned session directories.
   */
  async init(cacheDir: string) {
    this.cacheDir = cacheDir;
    const ffmpegPath = getFFmpegStaticPath();
    if (ffmpegPath) {
      this.ffmpegCapabilities = await detectFFmpegCapabilities(ffmpegPath);
    }
    await this.cleanupOrphanedSessions();
  }

  setCacheDir(dir: string) {
    this.cacheDir = dir;
  }

  async ensureSession(sessionId: string, filePath: string): Promise<string> {
    if (!this.cacheDir) {
      throw new Error('HlsManager: cacheDir not set');
    }

    // Reuse existing session if active
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status === HlsSessionStatus.ACTIVE) {
      this.touchSession(sessionId);
      return existing.playlistPath;
    }

    // Avoid double-spawning the same session
    if (this.pendingSessions.has(sessionId)) {
      await this.pendingSessions.get(sessionId);
      return this.sessions.get(sessionId)!.playlistPath;
    }

    // [SECURITY] Hard limit on concurrent transcodes to prevent CPU exhaustion
    if (this.sessions.size >= MAX_CONCURRENT_TRANSCODES) {
      throw new Error('Server too busy. Please try again later.');
    }

    const spawnPromise = (async () => {
      try {
        await this.startSession(sessionId, filePath);
      } finally {
        this.pendingSessions.delete(sessionId);
      }
    })();

    this.pendingSessions.set(sessionId, spawnPromise);
    await spawnPromise;

    return this.sessions.get(sessionId)!.playlistPath;
  }

  private async startSession(sessionId: string, filePath: string) {
    const outputDir = path.join(this.cacheDir!, sessionId);
    const playlistPath = path.join(outputDir, 'playlist.m3u8');

    // [SECURITY] Clean up old dir if exists to prevent stale segments
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    // Use p-queue to limit CPU load during startup
    await this.transcodeQueue.add(async () => {
      const ffmpegPath = getFFmpegStaticPath();
      if (!ffmpegPath) throw new Error('FFmpeg not found');

      const mediaSource = createMediaSource(filePath);
      const ffmpegInput = await mediaSource.getFFmpegInput();

      await getFFmpegStreams(ffmpegInput, ffmpegPath);
      const hardwareCodec = getHardwareCodec(this.ffmpegCapabilities!);

      const outputSegmentPath = path.join(outputDir, 'seg-%03d.ts');
      const args = getHlsTranscodeArgs(
        ffmpegInput,
        outputSegmentPath,
        playlistPath,
        HLS_SEGMENT_DURATION,
        {
          hwCodec: hardwareCodec,
        },
      );

      const proc = spawn(ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });

      const session: HlsSession = {
        id: sessionId,
        process: proc,
        lastAccess: Date.now(),
        outputDir,
        playlistPath,
        status: HlsSessionStatus.STARTING,
        progress: {
          currentTime: 0,
          duration: 0,
          percent: 0,
          fps: 0,
          speed: '0x',
        },
      };

      this.sessions.set(sessionId, session);

      this.setupProcessHandlers(session, proc);

      try {
        await this.waitForPlaylist(session);
        session.status = HlsSessionStatus.ACTIVE;
      } catch (err) {
        this.stopSession(sessionId);
        throw err;
      }
    });
  }

  private setupProcessHandlers(session: HlsSession, proc: ChildProcess) {
    let stderrBuffer = '';
    proc.stderr!.on('data', (data) => {
      const s = this.sessions.get(session.id);
      if (!s) return;

      stderrBuffer += data.toString();
      // Split by newline or carriage return (FFmpeg progress updates)
      const lines = stderrBuffer.split(/[\r\n]+/);
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        this.parseStderrLine(s, line);
      }
    });

    proc.on('error', (err) => {
      const s = this.sessions.get(session.id);
      if (!s) return;
      s.status = HlsSessionStatus.ERROR;
      s.error = err;
    });

    proc.on('exit', (code, signal) => {
      const s = this.sessions.get(session.id);
      if (!s) return;

      if (code !== 0 && signal !== 'SIGKILL') {
        console.error(
          `[HLS] Session ${session.id} exited with code ${code} (signal: ${signal})`,
        );
        s.status = HlsSessionStatus.ERROR;
        s.error = new Error(`FFmpeg exited with code ${code}`);
      } else {
        s.status = HlsSessionStatus.STOPPED;
        s.progress.percent = 100;
        if (s.progress.duration > 0) {
          s.progress.currentTime = s.progress.duration;
        }
      }
      s.process = null;
    });
  }

  private parseStderrLine(session: HlsSession, line: string) {
    // Duration: 00:01:40.00
    if (session.progress.duration === 0) {
      const durMatch = line.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
      if (durMatch) {
        const h = parseInt(durMatch[1], 10);
        const m = parseInt(durMatch[2], 10);
        const s = parseFloat(`${durMatch[3]}.${durMatch[4]}`);
        session.progress.duration = h * 3600 + m * 60 + s;
      }
    }

    // frame=  100 fps= 25 q=28.0 size=  1024kB time=00:00:10.00 bitrate= 838.9kbits/s speed=1.0x
    const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const s = parseFloat(`${timeMatch[3]}.${timeMatch[4]}`);
      session.progress.currentTime = h * 3600 + m * 60 + s;

      if (session.progress.duration > 0) {
        session.progress.percent = Math.floor(
          (session.progress.currentTime / session.progress.duration) * 100,
        );
      }
    }

    const fpsMatch = line.match(/fps=\s*(\d+)/);
    if (fpsMatch) {
      session.progress.fps = parseInt(fpsMatch[1], 10);
    }

    const speedMatch = line.match(/speed=\s*(\d+\.?\d*x)/);
    if (speedMatch) {
      session.progress.speed = speedMatch[1];
    }
  }

  private async waitForPlaylist(session: HlsSession) {
    const maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (session.status === HlsSessionStatus.ERROR) {
        throw session.error || new Error('HLS session failed');
      }

      try {
        const stats = await fs.stat(session.playlistPath);
        if (stats.size > 0) return;
      } catch {
        // file might not exist yet
      }

      attempts++;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Timeout waiting for HLS playlist');
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

  async stopSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (
      session.process &&
      typeof session.process.kill === 'function' &&
      !session.process.killed
    ) {
      session.process.kill('SIGTERM');
      // Give it a chance to exit gracefully, then kill if it hangs
      session.killTimeout = setTimeout(() => {
        // Double check session still exists and process is valid
        if (
          session.process &&
          typeof session.process.kill === 'function' &&
          !session.process.killed
        ) {
          try {
            session.process.kill('SIGKILL');
          } catch {
            // Ignore
          }
        }
        session.killTimeout = undefined;
      }, 2000);
    }

    this.sessions.delete(sessionId);

    try {
      await fs.rm(session.outputDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[HLS] Failed to clean up ${session.outputDir}:`, err);
    }
  }

  private startCleanupInterval() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  private async cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
        await this.stopSession(id);
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
        if (stats.isDirectory() && !this.sessions.has(dir)) {
          console.log(`[HLS] Cleaning up orphaned session directory: ${dir}`);
          await fs.rm(fullPath, { recursive: true, force: true });
        }
      }
    } catch (err) {
      console.error('[HLS] Startup cleanup failed:', err);
    }
  }
}
