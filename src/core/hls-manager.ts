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

interface HlsSession {
  process: ChildProcess | null;
  lastAccess: number;
  outputDir: string;
  playlistPath: string;
  processExited?: boolean;
  exitCode?: number | null;
  progress: {
    currentTime: number; // in seconds
    duration: number; // in seconds
    percent: number;
  };
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes inactivity timeout

export class HlsManager {
  private static instance: HlsManager;
  private sessions: Map<string, HlsSession> = new Map();
  private cacheDir: string | null = null;

  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    this.startCleanupInterval();
  }

  private startCleanupInterval() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    this.cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Stops the cleanup interval. Useful for testing.
   */
  stopCleanupInterval() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  static getInstance(): HlsManager {
    if (!HlsManager.instance) {
      HlsManager.instance = new HlsManager();
    }
    return HlsManager.instance;
  }

  setCacheDir(dir: string) {
    this.cacheDir = dir;
  }

  /**
   * Returns the progress of an HLS session.
   */
  getSessionProgress(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.progress;
  }

  async ensureSession(sessionId: string, filePath: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.sessions.get(sessionId)!.lastAccess = Date.now();
      return;
    }

    // [SECURITY] Enforce concurrency limit to prevent DoS
    if (this.sessions.size >= MAX_CONCURRENT_TRANSCODES) {
      console.warn(
        `[HLS] Session blocked due to concurrency limit (${this.sessions.size}/${MAX_CONCURRENT_TRANSCODES})`,
      );
      throw new Error('Server too busy. Please try again later.');
    }

    if (!this.cacheDir) {
      throw new Error('HLS Cache directory not set');
    }

    if (!ffmpegStatic) {
      throw new Error('FFmpeg not found');
    }

    const outputDir = path.join(this.cacheDir, sessionId);
    await fs.mkdir(outputDir, { recursive: true });

    const segmentPath = path.join(outputDir, 'segment_%03d.ts');
    const playlistPath = path.join(outputDir, 'playlist.m3u8');

    const source = createMediaSource(filePath);
    const inputPath = await source.getFFmpegInput();

    const args = getHlsTranscodeArgs(
      inputPath,
      segmentPath,
      playlistPath,
      HLS_SEGMENT_DURATION,
    );

    console.log(`[HLS] Starting session ${sessionId} for ${filePath}`);
    const proc = spawn(ffmpegStatic, args);

    const session: HlsSession = {
      process: proc,
      lastAccess: Date.now(),
      outputDir,
      playlistPath,
      progress: {
        currentTime: 0,
        duration: 0,
        percent: 0,
      },
    };
    this.sessions.set(sessionId, session);

    // Track progress from stderr
    let stderrBuffer = '';
    proc.stderr.on('data', (data) => {
      const str = data.toString();
      stderrBuffer += str;

      const lines = stderrBuffer.split(/[\r\n]+/);
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        // Parse Duration
        if (session.progress.duration === 0) {
          const durMatch = line.match(/Duration: (\d+):(\d+):(\d+)\.(\d+)/);
          if (durMatch) {
            const h = parseInt(durMatch[1], 10);
            const m = parseInt(durMatch[2], 10);
            const s = parseInt(durMatch[3], 10);
            session.progress.duration = h * 3600 + m * 60 + s;
          }
        }

        // Parse current time
        const timeMatch = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1], 10);
          const m = parseInt(timeMatch[2], 10);
          const s = parseInt(timeMatch[3], 10);
          session.progress.currentTime = h * 3600 + m * 60 + s;

          if (session.progress.duration > 0) {
            session.progress.percent = Math.min(
              100,
              Math.round(
                (session.progress.currentTime / session.progress.duration) *
                  100,
              ),
            );
          }
        }
      }
    });

    // Handle errors
    proc.on('error', (err) => {
      console.error(`[HLS] Session ${sessionId} error:`, err);
      this.stopSession(sessionId);
    });

    proc.on('exit', (code, signal) => {
      if (code !== 0 && signal !== 'SIGKILL') {
        console.error(`[HLS] Session ${sessionId} exited with code ${code}`);
      }

      if (session) {
        session.process = null;
        session.processExited = true;
        session.exitCode = code;

        // If it finished successfully, set progress to 100%
        if (code === 0) {
          session.progress.percent = 100;
          if (session.progress.duration > 0) {
            session.progress.currentTime = session.progress.duration;
          }
        }
      }
    });

    // Wait for playlist to be created?
    await this.waitForPlaylist(sessionId, playlistPath);
  }

  private async waitForPlaylist(
    sessionId: string,
    playlistPath: string,
    retries = 20,
  ): Promise<void> {
    for (let i = 0; i < retries; i++) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error('Session disappeared during HLS initialization');
      }

      if (
        session.processExited ||
        (session.process && session.process.killed)
      ) {
        throw new Error('HLS process exited before playlist creation');
      }

      try {
        await fs.access(playlistPath);
        return;
      } catch {
        // Wait 500ms
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error('Timeout waiting for HLS playlist');
  }

  getSessionDir(sessionId: string): string | undefined {
    // SECURITY: This returns the outputDir which is constructed from sessionId.
    // sessionId should be sanitized or generated safely.
    return this.sessions.get(sessionId)?.outputDir;
  }

  touchSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) session.lastAccess = Date.now();
  }

  stopSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.process && !session.process.killed) {
      session.process.kill('SIGKILL');
    }

    // Clean up files
    fs.rm(session.outputDir, { recursive: true, force: true }).catch((err) =>
      console.error(`[HLS] Failed to clean up ${session.outputDir}:`, err),
    );

    this.sessions.delete(sessionId);
  }

  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccess > SESSION_TIMEOUT_MS) {
        console.log(`[HLS] Cleaning up inactive session ${id}`);
        this.stopSession(id);
      }
    }
  }
}
