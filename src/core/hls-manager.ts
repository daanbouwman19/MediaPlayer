import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { getHlsTranscodeArgs } from './utils/ffmpeg-utils.ts';
import { createMediaSource } from './media-source.ts';
import {
  HLS_SEGMENT_DURATION,
  MAX_CONCURRENT_TRANSCODES,
} from './constants.ts';
import ffmpegStatic from 'ffmpeg-static';

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
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity timeout
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute cleanup check

export class HlsManager {
  private static instance: HlsManager;
  private sessions: Map<string, HlsSession> = new Map();
  private pendingSessions: Map<string, Promise<void>> = new Map();
  private cacheDir: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanupInterval();
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
    await this.cleanupOrphanedSessions();
  }

  setCacheDir(dir: string) {
    this.cacheDir = dir;
  }

  private startCleanupInterval() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = setInterval(
      () => this.cleanup(),
      CLEANUP_INTERVAL_MS,
    );
  }

  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Returns the current progress of an HLS session.
   */
  getSessionProgress(sessionId: string): HlsProgress | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return { ...session.progress };
  }

  /**
   * Ensures an HLS session is active for the given file.
   * Uses a promise-based lock to prevent duplicate spawns for the same ID.
   */
  async ensureSession(sessionId: string, filePath: string): Promise<void> {
    // 1. Check if already active
    const existing = this.sessions.get(sessionId);
    if (existing && existing.status !== HlsSessionStatus.ERROR) {
      existing.lastAccess = Date.now();
      return;
    }

    // 2. Check if already starting (lock)
    const pending = this.pendingSessions.get(sessionId);
    if (pending) {
      return pending;
    }

    // 3. Create new session promise
    const startPromise = this.startSession(sessionId, filePath);
    this.pendingSessions.set(sessionId, startPromise);

    try {
      await startPromise;
    } finally {
      this.pendingSessions.delete(sessionId);
    }
  }

  private async startSession(
    sessionId: string,
    filePath: string,
  ): Promise<void> {
    if (this.sessions.size >= MAX_CONCURRENT_TRANSCODES) {
      throw new Error('Server too busy. Please try again later.');
    }

    if (!this.cacheDir) throw new Error('HLS Cache directory not set');
    if (!ffmpegStatic) throw new Error('FFmpeg not found');

    const outputDir = path.join(this.cacheDir, sessionId);
    const playlistPath = path.join(outputDir, 'playlist.m3u8');
    const segmentPath = path.join(outputDir, 'segment_%03d.ts');

    // Clean up old dir if exists
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    const source = createMediaSource(filePath);
    const inputPath = await source.getFFmpegInput();

    const args = getHlsTranscodeArgs(
      inputPath,
      segmentPath,
      playlistPath,
      HLS_SEGMENT_DURATION,
    );

    const proc = spawn(ffmpegStatic, args);

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
  }

  private setupProcessHandlers(session: HlsSession, proc: ChildProcess) {
    let stderrBuffer = '';

    proc.stderr?.on('data', (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split(/[\r\n]+/);
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        this.parseStderrLine(session, line);
      }
    });

    proc.on('error', (err) => {
      console.error(`[HLS] Session ${session.id} spawn error:`, err);
      session.status = HlsSessionStatus.ERROR;
      session.error = err;
    });

    proc.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGKILL') {
        console.error(
          `[HLS] Session ${session.id} exited with code ${code} (signal: ${signal})`,
        );
        session.status = HlsSessionStatus.ERROR;
        session.error = new Error(`FFmpeg exited with code ${code}`);
      } else {
        session.status = HlsSessionStatus.STOPPED;
        session.progress.percent = 100;
        if (session.progress.duration > 0) {
          session.progress.currentTime = session.progress.duration;
        }
      }
      session.process = null;
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

    // frame=  100 fps= 25 q=28.0 size=     512kB time=00:00:50.00 bitrate=  83.9kbits/s speed=10.1x
    const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
    if (timeMatch) {
      const h = parseInt(timeMatch[1], 10);
      const m = parseInt(timeMatch[2], 10);
      const s = parseFloat(`${timeMatch[3]}.${timeMatch[4]}`);
      session.progress.currentTime = h * 3600 + m * 60 + s;

      const fpsMatch = line.match(/fps=\s*(\d+)/);
      if (fpsMatch) session.progress.fps = parseInt(fpsMatch[1], 10);

      const speedMatch = line.match(/speed=\s*(\d+\.?\d*x)/);
      if (speedMatch) session.progress.speed = speedMatch[1];

      if (session.progress.duration > 0) {
        session.progress.percent = Math.min(
          100,
          Math.round(
            (session.progress.currentTime / session.progress.duration) * 100,
          ),
        );
      }
    }
  }

  private async waitForPlaylist(
    session: HlsSession,
    retries = 30,
  ): Promise<void> {
    for (let i = 0; i < retries; i++) {
      if (session.status === HlsSessionStatus.ERROR) {
        throw (
          session.error || new Error('HLS process failed during initialization')
        );
      }

      try {
        const stats = await fs.stat(session.playlistPath);
        // Ensure the file is not empty
        if (stats.size > 0) return;
      } catch {
        // Ignore and retry
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error('Timeout waiting for HLS playlist');
  }

  getSessionDir(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.outputDir;
  }

  touchSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) session.lastAccess = Date.now();
  }

  async stopSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.process && !session.process.killed) {
      session.process.kill('SIGKILL');
    }

    this.sessions.delete(sessionId);

    try {
      await fs.rm(session.outputDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[HLS] Failed to clean up ${session.outputDir}:`, err);
    }
  }

  private async cleanup() {
    const now = Date.now();
    const toStop: string[] = [];

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
        toStop.push(id);
      }
    }

    for (const id of toStop) {
      console.log(`[HLS] Cleaning up inactive session ${id}`);
      await this.stopSession(id);
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
