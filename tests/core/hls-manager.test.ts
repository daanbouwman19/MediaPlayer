import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HlsManager } from '../../src/core/hls-manager.ts';
import EventEmitter from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { createMediaSource } from '../../src/core/media-source.ts';
import path from 'path';

vi.mock('../../src/core/media-source.ts', () => ({
  createMediaSource: vi.fn(),
}));

vi.mock('child_process', () => {
  const spawn = vi.fn();
  return {
    spawn,
    default: { spawn },
  };
});

vi.mock('fs/promises', () => {
  const mkdir = vi.fn();
  const access = vi.fn();
  const rm = vi.fn();
  const readdir = vi.fn();
  const stat = vi.fn();
  return {
    default: { mkdir, access, rm, readdir, stat },
    mkdir,
    access,
    rm,
    readdir,
    stat,
  };
});

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

const mockSpawn = vi.mocked(spawn);
const mockCreateMediaSource = vi.mocked(createMediaSource);
const mockFsMkdir = vi.mocked(fs.mkdir);
const mockFsRm = vi.mocked(fs.rm);
const mockFsStat = vi.mocked(fs.stat);
const mockFsReaddir = vi.mocked(fs.readdir);

describe('HlsManager Robustness', () => {
  const CACHE_DIR = '/tmp/hls-robust';
  let hlsManager: HlsManager;

  const createMockProcess = () => {
    const proc = new EventEmitter() as any;
    proc.kill = vi.fn();
    proc.stderr = new EventEmitter();
    proc.stdin = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.killed = false;
    return proc;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    // Deep reset of the singleton internal state
    (hlsManager as any).sessions.clear();
    (hlsManager as any).pendingSessions.clear();
    hlsManager.stopCleanupInterval();

    // Default mocks
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);
    mockFsStat.mockResolvedValue({
      size: 100,
      isDirectory: () => true,
    } as any);
    mockFsReaddir.mockResolvedValue([]);

    mockCreateMediaSource.mockImplementation((filePath: string) => ({
      getFFmpegInput: vi.fn().mockResolvedValue(filePath),
      getStream: vi.fn(),
      getMimeType: vi.fn(),
      getSize: vi.fn(),
      getType: () => 'local',
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents multiple spawns for the same session ID via locking', async () => {
    const sessionId = 'race-condition';
    const filePath = '/movie.mp4';

    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Call ensureSession multiple times concurrently
    const p1 = hlsManager.ensureSession(sessionId, filePath);
    const p2 = hlsManager.ensureSession(sessionId, filePath);
    const p3 = hlsManager.ensureSession(sessionId, filePath);

    // Advance timers so waitForPlaylist can succeed
    await vi.advanceTimersByTimeAsync(500);

    await Promise.all([p1, p2, p3]);

    // Should only have spawned ONCE
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('cleans up and throws if FFmpeg fails during startup', async () => {
    const sessionId = 'startup-fail';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Playlist check will fail initially
    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');

    // Catch the promise early to avoid unhandled rejection
    promise.catch(() => {});

    // Give it a microtick to spawn
    await vi.advanceTimersByTimeAsync(0);

    mockProcess.emit('error', new Error('Execution failed'));

    // Advance timers to trigger waitForPlaylist's next check
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toThrow('Execution failed');
    expect(mockFsRm).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      expect.anything(),
    );
    expect((hlsManager as any).sessions.has(sessionId)).toBe(false);
  });

  it('handles FFmpeg exit during playlist wait', async () => {
    const sessionId = 'exit-during-wait';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Playlist check will fail
    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    // Process exits with error
    mockProcess.emit('exit', 1, null);

    // Next timer tick should detect the exit
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toThrow('FFmpeg exited with code 1');
  });

  it('parses duration and progress correctly from stderr', async () => {
    const sessionId = 'progress-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    await vi.advanceTimersByTimeAsync(500); // Trigger successful waitForPlaylist
    await promise;

    const session = (hlsManager as any).sessions.get(sessionId);

    // 1. Send Duration
    mockProcess.stderr.emit(
      'data',
      Buffer.from('Duration: 00:02:00.00, start: 0.000000\n'),
    );
    expect(session.progress.duration).toBe(120);

    // 2. Send Progress Time
    mockProcess.stderr.emit(
      'data',
      Buffer.from(
        'frame=  100 fps= 25 q=28.0 size=     512kB time=00:01:00.00 bitrate=  83.9kbits/s speed=10.0x\n',
      ),
    );
    expect(session.progress.currentTime).toBe(60);
    expect(session.progress.percent).toBe(50);
    expect(session.progress.fps).toBe(25);
    expect(session.progress.speed).toBe('10.0x');
  });

  it('performs startup cleanup of orphaned directories', async () => {
    mockFsReaddir.mockResolvedValue(['session-old', 'session-active'] as any);

    // We mock sessions map to have 'session-active'
    (hlsManager as any).sessions.set('session-active', {
      outputDir: path.join(CACHE_DIR, 'session-active'),
      process: createMockProcess(),
    });

    await hlsManager.init(CACHE_DIR);

    // Should only have cleaned up 'session-old'
    expect(mockFsRm).toHaveBeenCalledWith(
      path.join(CACHE_DIR, 'session-old'),
      expect.anything(),
    );
    expect(mockFsRm).not.toHaveBeenCalledWith(
      path.join(CACHE_DIR, 'session-active'),
      expect.anything(),
    );
  });

  it('times out if playlist is never created', async () => {
    const sessionId = 'timeout';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Always fail stat
    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    // Advance 30 retries * 500ms = 15s
    for (let i = 0; i < 31; i++) {
      await vi.advanceTimersByTimeAsync(500);
    }

    await expect(promise).rejects.toThrow('Timeout waiting for HLS playlist');
  });

  it('getSessionDir returns correct directory', async () => {
    const sessionId = 'dir-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(hlsManager.getSessionDir(sessionId)).toBe(
      path.join(CACHE_DIR, sessionId),
    );
    expect(hlsManager.getSessionDir('unknown')).toBeUndefined();
  });

  it('touchSession updates lastAccess', async () => {
    const sessionId = 'touch-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    const oldAccess = (hlsManager as any).sessions.get(sessionId).lastAccess;
    await vi.advanceTimersByTimeAsync(100);
    hlsManager.touchSession(sessionId);
    expect(
      (hlsManager as any).sessions.get(sessionId).lastAccess,
    ).toBeGreaterThan(oldAccess);
  });

  it('cleanup interval stops inactive sessions', async () => {
    const sessionId = 'timeout-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    // Fast forward 6 minutes
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

    await (hlsManager as any).cleanup();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect((hlsManager as any).sessions.has(sessionId)).toBe(false);
  });

  it('stopSession safely ignores unknown sessions', async () => {
    await hlsManager.stopSession('unknown-session');
  });

  it('getSessionProgress handles unknown session', () => {
    expect(hlsManager.getSessionProgress('unknown')).toBeNull();
  });

  it('stopCleanupInterval safely handles null', () => {
    hlsManager.stopCleanupInterval();
    hlsManager.stopCleanupInterval();
  });

  it('ensureSession throws if cacheDir is not set', async () => {
    hlsManager.setCacheDir(null as any);
    const promise = hlsManager.ensureSession('no-cache', '/test.mp4');
    promise.catch(() => {});
    await expect(promise).rejects.toThrow('HLS Cache directory not set');
  });

  it('ensureSession reuses active session', async () => {
    const sessionId = 'reuse-session';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // First call
    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    // Second call
    await hlsManager.ensureSession(sessionId, '/test.mp4');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('stopSession catches fs.rm errors', async () => {
    const sessionId = 'fs-rm-error';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('rm fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await hlsManager.stopSession(sessionId);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[HLS] Failed to clean up'),
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('init catches fs.readdir errors', async () => {
    vi.spyOn(fs, 'readdir').mockRejectedValueOnce(new Error('readdir fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await hlsManager.init('/fail-dir');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[HLS] Startup cleanup failed:',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('proc exit success sets currentTime to duration if duration > 0', async () => {
    const sessionId = 'exit-duration';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    // Simulate ffmpeg stderr duration
    mockProcess.stderr?.emit('data', 'Duration: 01:00:00.00\n');

    // Simulate exit 0
    mockProcess.emit('exit', 0, null);

    const progress = hlsManager.getSessionProgress(sessionId);
    expect(progress?.percent).toBe(100);
    expect(progress?.currentTime).toBe(3600);
  });

  it('parses stderr for time, fps, speed correctly', async () => {
    const sessionId = 'stderr-parse';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    mockProcess.stderr?.emit('data', 'Duration: 01:00:00.00\n');
    mockProcess.stderr?.emit(
      'data',
      'frame=  100 fps= 25 q=28.0 size= 512kB time=00:30:00.00 bitrate= 83.9kbits/s speed=10.1x\n',
    );

    const progress = hlsManager.getSessionProgress(sessionId);
    expect(progress?.fps).toBe(25);
    expect(progress?.speed).toBe('10.1x');
    expect(progress?.currentTime).toBe(1800);
    expect(progress?.percent).toBe(50);
  });

  it('proc exit handles SIGKILL identically to success', async () => {
    const sessionId = 'sigkill-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    mockProcess.emit('exit', null, 'SIGKILL');
    // Session stopped successfully instead of ERROR
    expect((hlsManager as any).sessions.get(sessionId).status).toBe('stopped');
  });
});
