import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HlsManager } from '../../src/core/hls-manager.ts';
import EventEmitter from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import { createMediaSource } from '../../src/core/media-source.ts';

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
  const readFile = vi.fn();
  return {
    default: { mkdir, access, rm, readFile },
    mkdir,
    access,
    rm,
    readFile,
    constants: { F_OK: 0 },
  };
});

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

const mockSpawn = vi.mocked(spawn);
const mockCreateMediaSource = vi.mocked(createMediaSource);
const mockFsMkdir = vi.mocked(fs.mkdir);
const mockFsAccess = vi.mocked(fs.access);
const mockFsRm = vi.mocked(fs.rm);

describe('HlsManager', () => {
  const CACHE_DIR = '/tmp/hls';
  let hlsManager: HlsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Singleton management
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    // Clear sessions and stop interval to prevent leakage
    if (hlsManager) {
      hlsManager.stopCleanupInterval();
      if ((hlsManager as any).sessions) {
        (hlsManager as any).sessions.clear();
      }
    }

    // Default fs behavior
    mockFsAccess.mockResolvedValue(undefined); // File exists
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);

    // Default media source mock
    mockCreateMediaSource.mockImplementation((filePath: string) => ({
      getFFmpegInput: vi.fn().mockResolvedValue(filePath),
      getStream: vi.fn(),
      getMimeType: vi.fn(),
      getSize: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts a new session correctly', async () => {
    const sessionId = 'session1';
    const filePath = '/path/to/movie.mp4';

    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, filePath);

    expect(mockFsMkdir).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      { recursive: true },
    );

    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/bin/ffmpeg',
      expect.arrayContaining([
        '-i',
        filePath,
        '-f',
        'hls',
        expect.stringContaining('playlist.m3u8'),
      ]),
    );
  });

  it('stops session and cleans up resources', async () => {
    const sessionId = 'session2';
    const filePath = '/path/to/movie.mp4';

    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = vi.fn((event, callback) => {
      mockProcess.stderr.addListener(event, callback);
      return mockProcess.stderr;
    });
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, filePath);

    hlsManager.stopSession(sessionId);

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mockFsRm).toHaveBeenCalledWith(expect.stringContaining(sessionId), {
      recursive: true,
      force: true,
    });
  });

  it('cleans up inactive sessions after timeout', async () => {
    const sessionId = 'session3';
    const filePath = '/path/to/movie.mp4';

    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = vi.fn((event, callback) => {
      mockProcess.stderr.addListener(event, callback);
      return mockProcess.stderr;
    });
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, filePath);

    // Advance time by 6 minutes (timeout is 5 min)
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);

    // Manual cleanup call since interval depends on singleton state
    (hlsManager as any).cleanup();

    expect(mockProcess.kill).toHaveBeenCalled();
    expect(mockFsRm).toHaveBeenCalled();
  });

  it('updates last access time on touch', async () => {
    const sessionId = 'session4';
    const filePath = '/path/to/movie.mp4';

    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = vi.fn((event, callback) => {
      mockProcess.stderr.addListener(event, callback);
      return mockProcess.stderr;
    });
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, filePath);

    vi.setSystemTime(Date.now() + 3 * 60 * 1000);
    hlsManager.touchSession(sessionId);

    vi.setSystemTime(Date.now() + 3 * 60 * 1000); // +3 min from touch
    (hlsManager as any).cleanup();

    expect(mockProcess.kill).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + 3 * 60 * 1000); // +6 min from touch
    (hlsManager as any).cleanup();

    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it('returns the same instance (singleton)', () => {
    const instance1 = HlsManager.getInstance();
    const instance2 = HlsManager.getInstance();
    expect(instance1).toBe(instance2);
  });

  it('throws error if cache directory is not set', async () => {
    (hlsManager as any).cacheDir = null;
    await expect(hlsManager.ensureSession('test', '/path')).rejects.toThrow(
      'HLS Cache directory not set',
    );
  });

  it('handles ffmpeg spawn error', async () => {
    const sessionId = 'error-spawn';
    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Playlist does not exist yet
    mockFsAccess.mockRejectedValue(new Error('no ent'));

    // Silence the error event
    mockProcess.on('error', () => {});

    // Start ensuring session - it will wait for playlist
    const promise = hlsManager.ensureSession(sessionId, '/path');

    // Give it a tick to reach the spawn call and register listeners
    let retries = 0;
    while (mockSpawn.mock.calls.length === 0 && retries++ < 50) {
      await Promise.resolve();
    }

    // Simulate spawn error immediately
    mockProcess.emit('error', new Error('Spawn failed'));

    // Advancing timers should cause the promise to resolve/reject
    await Promise.all([
      expect(promise).rejects.toThrow(),
      vi.runAllTimersAsync(),
    ]);

    expect(consoleSpy.mock.calls[0][0]).toContain('error-spawn');
    expect(consoleSpy.mock.calls[0][1]).toBeInstanceOf(Error);
    consoleSpy.mockRestore();
  });

  it('handles ffmpeg non-zero exit code', async () => {
    const sessionId = 'error-exit';
    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFsAccess.mockRejectedValue(new Error('no ent'));
    const promise = hlsManager.ensureSession(sessionId, '/path');

    // Give it a tick to reach the spawn call and register listeners
    let retries = 0;
    while (mockSpawn.mock.calls.length === 0 && retries++ < 50) {
      await Promise.resolve();
    }

    // Simulate non-zero exit
    mockProcess.emit('exit', 1, null);
    mockProcess.exitCode = 1;

    // Advancing timers should cause the promise to resolve/reject
    await Promise.all([
      expect(promise).rejects.toThrow(
        'HLS process exited before playlist creation',
      ),
      vi.runAllTimersAsync(),
    ]);

    expect(consoleSpy.mock.calls[0][0]).toContain('exited with code 1');
    consoleSpy.mockRestore();
  });

  it('stopSession handles already killed process', async () => {
    const sessionId = 'killed';
    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = vi.fn((event, callback) => {
      mockProcess.stderr.addListener(event, callback);
      return mockProcess.stderr;
    });
    mockProcess.exitCode = null;
    mockFsAccess.mockResolvedValue(undefined);
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, '/path');
    mockProcess.killed = true;
    hlsManager.stopSession(sessionId);

    expect(mockProcess.kill).not.toHaveBeenCalled();
  });

  it('stopSession handles cleanup error', async () => {
    const sessionId = 'cleanup-error';
    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = vi.fn((event, callback) => {
      mockProcess.stderr.addListener(event, callback);
      return mockProcess.stderr;
    });
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, '/path');

    mockFsRm.mockRejectedValue(new Error('RM failed'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    hlsManager.stopSession(sessionId);

    await vi.advanceTimersByTimeAsync(0); // Flush microticks for the RM promise

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clean up'),
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('ensureSession updates lastAccess if session exists', async () => {
    const sessionId = 'exists';
    const mockProcess = new EventEmitter() as any;
    mockProcess.kill = vi.fn();
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    mockProcess.stderr.on = vi.fn((event, callback) => {
      mockProcess.stderr.addListener(event, callback);
      return mockProcess.stderr;
    });
    mockProcess.exitCode = null;
    mockProcess.killed = false;
    mockSpawn.mockReturnValue(mockProcess);

    await hlsManager.ensureSession(sessionId, '/path');
    const firstAccess = (hlsManager as any).sessions.get(sessionId).lastAccess;

    vi.setSystemTime(Date.now() + 1000);
    await hlsManager.ensureSession(sessionId, '/path');

    const secondAccess = (hlsManager as any).sessions.get(sessionId).lastAccess;
    expect(secondAccess).toBeGreaterThan(firstAccess);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });
});
