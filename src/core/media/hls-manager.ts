import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import PQueue from 'p-queue';
import { EventEmitter } from 'events';
import {
  getHlsTranscodeArgs,
  detectFFmpegCapabilities,
  getHardwareCodec,
  getFFmpegStreams,
  canStreamCopy,
} from '../../infrastructure/ffmpeg-utils.ts';
import { createMediaSource } from './media-source.ts';
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

export enum HlsSessionStatus {
  STARTING = 'starting',
  ACTIVE = 'active',
  ERROR = 'error',
  STOPPED = 'stopped',
  COMPLETE = 'complete',
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
  consumers: number;
  idleTimer?: NodeJS.Timeout;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const EAGER_IDLE_GRACE_MS = 30 * 1000;

export class HlsManager extends EventEmitter {
  private static instance: HlsManager | null = null;
  private sessions: Map<string, HlsSession> = new Map();
  private pendingSessions: Map<string, Promise<void>> = new Map();
  private transcodeQueue = new PQueue({
    concurrency: MAX_CONCURRENT_TRANSCODES,
  });
  private pinnedSessions: Set<string> = new Set();
  private cacheDir: string | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private ffmpegCapabilities: Awaited<
    ReturnType<typeof detectFFmpegCapabilities>
  > | null = null;

  private constructor() {
    super();
  }

  public static resetInstance() {
    if (HlsManager.instance) {
      HlsManager.instance.stopCleanupInterval();
      HlsManager.instance.sessions.forEach((s) => {
        if (s.killTimeout) {
          clearTimeout(s.killTimeout);
        }
        if (s.idleTimer) {
          clearTimeout(s.idleTimer);
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
      HlsManager.instance.pinnedSessions.clear();
      HlsManager.instance.removeAllListeners();
      HlsManager.instance = null;
    }
  }

  static getInstance(): HlsManager {
    if (!HlsManager.instance) {
      HlsManager.instance = new HlsManager();
    }
    return HlsManager.instance;
  }

  private setSessionStatus(session: HlsSession, status: HlsSessionStatus) {
    session.status = status;
    this.emit(`status:${session.id}`, status);
  }

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

  pinSession(id: string) {
    this.pinnedSessions.add(id);
  }

  unpinSession(id: string) {
    this.pinnedSessions.delete(id);
  }

  waitForSession(sessionId: string): Promise<HlsSessionStatus> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.resolve(HlsSessionStatus.STOPPED);
    }
    if (
      session.status === HlsSessionStatus.COMPLETE ||
      session.status === HlsSessionStatus.ERROR ||
      session.status === HlsSessionStatus.STOPPED
    ) {
      return Promise.resolve(session.status);
    }

    return new Promise((resolve) => {
      const onStatus = (status: HlsSessionStatus) => {
        if (
          status === HlsSessionStatus.COMPLETE ||
          status === HlsSessionStatus.ERROR ||
          status === HlsSessionStatus.STOPPED
        ) {
          this.removeListener(`status:${sessionId}`, onStatus);
          resolve(status);
        }
      };
      this.on(`status:${sessionId}`, onStatus);
    });
  }

  async ensureSession(sessionId: string, filePath: string): Promise<string> {
    if (!this.cacheDir) {
      throw new Error('HlsManager: cacheDir not set');
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (
        existing.status === HlsSessionStatus.ACTIVE ||
        existing.status === HlsSessionStatus.COMPLETE
      ) {
        this.touchSession(sessionId);
        return existing.playlistPath;
      }
    }

    if (this.pendingSessions.has(sessionId)) {
      await this.pendingSessions.get(sessionId);
      return this.sessions.get(sessionId)!.playlistPath;
    }

    this.startCleanupInterval();

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

  async ensureSessionUnthrottled(
    sessionId: string,
    filePath: string,
  ): Promise<string> {
    if (!this.cacheDir) {
      throw new Error('HlsManager: cacheDir not set');
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      if (
        existing.status === HlsSessionStatus.ACTIVE ||
        existing.status === HlsSessionStatus.COMPLETE
      ) {
        this.touchSession(sessionId);
        return existing.playlistPath;
      }
    }

    this.startCleanupInterval();

    if (this.pendingSessions.has(sessionId)) {
      await this.pendingSessions.get(sessionId);
      return this.sessions.get(sessionId)!.playlistPath;
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

    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    await this.transcodeQueue.add(async () => {
      const ffmpegPath = getFFmpegStaticPath();
      if (!ffmpegPath) throw new Error('FFmpeg not found');

      const mediaSource = createMediaSource(filePath);
      const ffmpegInput = await mediaSource.getFFmpegInput();

      const streamsInfo = await getFFmpegStreams(ffmpegInput, ffmpegPath);
      const hardwareCodec = getHardwareCodec(this.ffmpegCapabilities!);

      const { copyVideo, copyAudio } = canStreamCopy(
        streamsInfo.videoCodec,
        streamsInfo.audioCodec,
      );

      const outputSegmentPath = path.join(outputDir, 'seg-%03d.ts');
      const args = getHlsTranscodeArgs(
        ffmpegInput,
        outputSegmentPath,
        playlistPath,
        HLS_SEGMENT_DURATION,
        {
          hwCodec: hardwareCodec,
          copyVideo,
          copyAudio,
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
        consumers: 0,
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
        this.setSessionStatus(session, HlsSessionStatus.ACTIVE);
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
      const lines = stderrBuffer.split(/[\r\n]+/);
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        this.parseStderrLine(s, line);
      }
    });

    proc.on('error', (err) => {
      const s = this.sessions.get(session.id);
      if (!s) return;
      s.error = err;
      this.setSessionStatus(s, HlsSessionStatus.ERROR);
    });

    proc.on('exit', (code, signal) => {
      const s = this.sessions.get(session.id);
      if (!s) return;

      if (code !== 0 && signal !== 'SIGKILL') {
        console.error(
          `[HLS] Session ${session.id} exited with code ${code} (signal: ${signal})`,
        );
        s.error = new Error(`FFmpeg exited with code ${code}`);
        this.setSessionStatus(s, HlsSessionStatus.ERROR);
      } else {
        const finalStatus = this.pinnedSessions.has(session.id)
          ? HlsSessionStatus.COMPLETE
          : HlsSessionStatus.STOPPED;
        s.progress.percent = 100;
        if (s.progress.duration > 0) {
          s.progress.currentTime = s.progress.duration;
        }
        this.setSessionStatus(s, finalStatus);
      }
      s.process = null;
    });
  }

  private parseStderrLine(session: HlsSession, line: string) {
    if (line.includes('Opening') && line.includes('playlist.m3u8')) {
      this.emit(`playlistReady:${session.id}`);
    }

    if (session.progress.duration === 0) {
      const durMatch = line.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
      if (durMatch) {
        const h = parseInt(durMatch[1], 10);
        const m = parseInt(durMatch[2], 10);
        const s = parseFloat(`${durMatch[3]}.${durMatch[4]}`);
        session.progress.duration = h * 3600 + m * 60 + s;
      }
    }

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

  private async waitForPlaylist(session: HlsSession): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout waiting for HLS playlist'));
      }, 10000);

      let checkInterval: NodeJS.Timeout | null = null;

      const cleanup = () => {
        clearTimeout(timeout);
        if (checkInterval) clearInterval(checkInterval);
        this.removeListener(`playlistReady:${session.id}`, onReady);
        this.removeListener(`status:${session.id}`, onStatus);
      };

      const onReady = () => {
        cleanup();
        resolve();
      };

      const checkFile = async () => {
        try {
          const stats = await fs.stat(session.playlistPath);
          if (stats.size > 0) {
            onReady();
            return true;
          }
        } catch {
          // not ready
        }
        return false;
      };

      const onStatus = async (status: HlsSessionStatus) => {
        if (status === HlsSessionStatus.ERROR) {
          cleanup();
          reject(
            session.error ||
              new Error('HLS session failed before playlist ready'),
          );
        } else if (
          status === HlsSessionStatus.STOPPED ||
          status === HlsSessionStatus.COMPLETE
        ) {
          // If stopped/completed naturally, check one last time before rejecting
          const isReady = await checkFile();
          if (!isReady) {
            cleanup();
            reject(new Error('HLS session finished but playlist not found'));
          }
        }
      };

      this.on(`playlistReady:${session.id}`, onReady);
      this.on(`status:${session.id}`, onStatus);

      // Safety check and periodic fallback for cases where FFmpeg misses logging or size=0
      checkFile();
      checkInterval = setInterval(checkFile, 500);
    });
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
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }
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
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    session.idleTimer = setTimeout(() => {
      const current = this.sessions.get(sessionId);
      if (!current) return;
      if (current.consumers > 0) return;
      if (this.pinnedSessions.has(sessionId)) return;
      void this.stopSession(sessionId);
    }, EAGER_IDLE_GRACE_MS);
    if (typeof session.idleTimer.unref === 'function') {
      session.idleTimer.unref();
    }
  }

  async stopSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.pinnedSessions.delete(sessionId);

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = undefined;
    }

    if (
      session.process &&
      typeof session.process.kill === 'function' &&
      !session.process.killed
    ) {
      session.process.kill('SIGTERM');
      session.killTimeout = setTimeout(() => {
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
    this.removeAllListeners(`status:${sessionId}`);
    this.removeAllListeners(`playlistReady:${sessionId}`);

    if (this.sessions.size === 0) {
      this.stopCleanupInterval();
    }

    try {
      await fs.rm(session.outputDir, { recursive: true, force: true });
    } catch (err) {
      console.error(`[HLS] Failed to clean up ${session.outputDir}:`, err);
    }
  }

  private startCleanupInterval() {
    if (!this.cleanupInterval) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, CLEANUP_INTERVAL_MS);
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
    for (const [id, session] of this.sessions.entries()) {
      if (this.pinnedSessions.has(id)) continue;
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
