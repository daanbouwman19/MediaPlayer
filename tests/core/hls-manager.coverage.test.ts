import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';

// vi.hoisted ensures these are available inside vi.mock factory closures
const { mockSpawn, mockFsMkdir, mockFsRm, mockFsStat, mockFsReaddir } =
  vi.hoisted(() => ({
    mockSpawn: vi.fn(),
    mockFsMkdir: vi.fn(),
    mockFsRm: vi.fn(),
    mockFsStat: vi.fn(),
    mockFsReaddir: vi.fn(),
  }));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: mockFsMkdir,
    rm: mockFsRm,
    readdir: mockFsReaddir,
    stat: mockFsStat,
  },
  mkdir: mockFsMkdir,
  rm: mockFsRm,
  readdir: mockFsReaddir,
  stat: mockFsStat,
}));

vi.mock('../../src/core/media-source.ts', () => ({
  createMediaSource: vi.fn().mockImplementation((filePath: string) => ({
    getFFmpegInput: vi.fn().mockResolvedValue(filePath),
    getStream: vi.fn(),
    getMimeType: vi.fn(),
    getSize: vi.fn(),
    getType: () => 'local',
  })),
}));

vi.mock('../../src/core/utils/ffmpeg-utils.ts', () => ({
  getHlsTranscodeArgs: vi.fn().mockReturnValue(['-f', 'hls', 'playlist.m3u8']),
  detectFFmpegCapabilities: vi.fn().mockResolvedValue({
    nvenc: false,
    videotoolbox: false,
    vaapi: false,
  }),
  getHardwareCodec: vi.fn().mockReturnValue(null),
  getFFmpegStreams: vi.fn().mockResolvedValue({
    hasVideo: true,
    hasAudio: true,
    videoCodec: 'h264',
    audioCodec: 'aac',
  }),
  canStreamCopy: vi.fn().mockReturnValue({ copyVideo: true, copyAudio: true }),
}));

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

import { HlsManager } from '../../src/core/hls-manager.ts';

describe('HlsManager Coverage Boost', () => {
  const CACHE_DIR = '/tmp/hls-coverage';
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
    HlsManager.resetInstance();
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);
    mockFsStat.mockResolvedValue({ size: 100, isDirectory: () => true });
    mockFsReaddir.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    HlsManager.resetInstance();
  });

  it('throws error if cacheDir is not set in ensureSession', async () => {
    (hlsManager as any).cacheDir = null;
    await expect(hlsManager.ensureSession('id', 'path')).rejects.toThrow(
      'HlsManager: cacheDir not set',
    );
  });

  it('parses fps and speed from stderr', async () => {
    const sessionId = 'extra-parse-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(1);

    mockProcess.stderr.emit(
      'data',
      'frame= 100 fps= 25 q=28.0 size= 1024kB time=00:00:10.00 bitrate= 838.9kbits/s speed=1.5x\n',
    );

    await vi.advanceTimersByTimeAsync(500);
    await promise;

    const progress = hlsManager.getSessionProgress(sessionId);
    expect(progress?.fps).toBe(25);
    expect(progress?.speed).toBe('1.5x');
  });

  it('handles multiple lines and partial lines in stderr', async () => {
    const sessionId = 'buffer-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(1);

    mockProcess.stderr.emit('data', 'Duration: 00:01:40.00\ntime=00:00:1');
    mockProcess.stderr.emit(
      'data',
      "0.00\nfps=30\nOpening 'playlist.m3u8' for writing\n",
    );

    await vi.advanceTimersByTimeAsync(500);
    await promise;

    const progress = hlsManager.getSessionProgress(sessionId);
    expect(progress?.duration).toBe(100);
    expect(progress?.currentTime).toBe(10);
    expect(progress?.fps).toBe(30);
  });

  it('handles SIGKILL timeout in stopSession', async () => {
    const sessionId = 'kill-timeout-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    mockProcess.stderr.emit('data', "Opening 'playlist.m3u8' for writing\n");
    await promise;

    await hlsManager.stopSession(sessionId);
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');

    // Advance time to trigger SIGKILL timeout
    await vi.advanceTimersByTimeAsync(2001);
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('handles process already killed during SIGKILL timeout', async () => {
    const sessionId = 'kill-already-dead';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    mockProcess.stderr.emit('data', "Opening 'playlist.m3u8' for writing\n");
    await promise;

    await hlsManager.stopSession(sessionId);
    mockProcess.killed = true;

    await vi.advanceTimersByTimeAsync(2001);
    expect(mockProcess.kill).not.toHaveBeenCalledWith('SIGKILL');
  });

  it('getSessionDir returns null if cacheDir not set', () => {
    (hlsManager as any).cacheDir = null;
    expect(hlsManager.getSessionDir('test')).toBeNull();
  });

  it('getSessionProgress returns null if session not found', () => {
    expect(hlsManager.getSessionProgress('non-existent')).toBeNull();
  });

  it('touchSession does nothing if session not found', () => {
    expect(() => hlsManager.touchSession('non-existent')).not.toThrow();
  });

  it('stopSession does nothing if session not found', async () => {
    await expect(hlsManager.stopSession('non-existent')).resolves.not.toThrow();
  });

  it('cleanupOrphanedSessions handles mixed files and directories', async () => {
    mockFsReaddir.mockResolvedValue([
      'session-1',
      'session-2',
      'not-a-session',
      'session-file',
    ]);

    mockFsStat.mockImplementation(async (p: string) => {
      if (p.endsWith('session-1')) return { isDirectory: () => true };
      if (p.endsWith('session-2')) return { isDirectory: () => true };
      if (p.endsWith('session-file')) return { isDirectory: () => false };
      return { isDirectory: () => true };
    });

    await hlsManager.init(CACHE_DIR);

    expect(mockFsRm).toHaveBeenCalledTimes(3);
    expect(mockFsRm).toHaveBeenCalledWith(
      expect.stringContaining('session-1'),
      expect.anything(),
    );
    expect(mockFsRm).toHaveBeenCalledWith(
      expect.stringContaining('session-2'),
      expect.anything(),
    );
    expect(mockFsRm).not.toHaveBeenCalledWith(
      expect.stringContaining('session-file'),
      expect.anything(),
    );
  });

  it('cleanupOrphanedSessions handles errors during readdir', async () => {
    mockFsReaddir.mockRejectedValue(new Error('Read error'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await hlsManager.init(CACHE_DIR);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[HLS] Startup cleanup failed:',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('waitForPlaylist handles playlist size 0', async () => {
    const sessionId = 'size-0-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    mockFsStat
      .mockResolvedValueOnce({ size: 0 })
      .mockResolvedValueOnce({ size: 100 });

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(mockFsStat).toHaveBeenCalledTimes(2);
  });

  it('pinSession and unpinSession prevent/allow cleanup eviction', async () => {
    const sessionId = 'pin-test';
    (hlsManager as any).sessions.set(sessionId, {
      id: sessionId,
      process: null,
      lastAccess: Date.now() - 999999,
      outputDir: '/tmp/out/pin-test',
      playlistPath: '/tmp/out/pin-test/playlist.m3u8',
      status: 'complete',
      progress: {},
      killTimeout: null,
    });

    hlsManager.pinSession(sessionId);

    // Cleanup should skip pinned session
    await (hlsManager as any).cleanup();
    expect((hlsManager as any).sessions.has(sessionId)).toBe(true);

    // Unpin and cleanup should evict it
    hlsManager.unpinSession(sessionId);
    await (hlsManager as any).cleanup();
    expect((hlsManager as any).sessions.has(sessionId)).toBe(false);
  });

  it('ensureSessionUnthrottled returns early for ACTIVE session', async () => {
    const sessionId = 'unthrottled-active';
    (hlsManager as any).sessions.set(sessionId, {
      id: sessionId,
      process: null,
      lastAccess: Date.now(),
      outputDir: '/tmp/out',
      playlistPath: '/tmp/out/playlist.m3u8',
      status: 'active',
      progress: {},
      killTimeout: null,
    });

    const result = await hlsManager.ensureSessionUnthrottled(
      sessionId,
      '/v.mp4',
    );
    expect(result).toBe('/tmp/out/playlist.m3u8');
  });

  it('ensureSessionUnthrottled returns early for COMPLETE session', async () => {
    const sessionId = 'unthrottled-complete';
    (hlsManager as any).sessions.set(sessionId, {
      id: sessionId,
      process: null,
      lastAccess: Date.now(),
      outputDir: '/tmp/out',
      playlistPath: '/tmp/out/playlist.m3u8',
      status: 'complete',
      progress: {},
      killTimeout: null,
    });

    const result = await hlsManager.ensureSessionUnthrottled(
      sessionId,
      '/v.mp4',
    );
    expect(result).toBe('/tmp/out/playlist.m3u8');
  });

  it('ensureSessionUnthrottled throws if cacheDir not set', async () => {
    (hlsManager as any).cacheDir = null;
    await expect(
      hlsManager.ensureSessionUnthrottled('id', '/v.mp4'),
    ).rejects.toThrow('HlsManager: cacheDir not set');
  });

  it('ensureSessionUnthrottled waits for pending session', async () => {
    const sessionId = 'unthrottled-pending';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Start a pending session via ensureSession
    const p1 = hlsManager.ensureSession(sessionId, '/v.mp4');
    await vi.advanceTimersByTimeAsync(500);

    // Call ensureSessionUnthrottled while pending
    const p2 = hlsManager.ensureSessionUnthrottled(sessionId, '/v.mp4');
    await vi.advanceTimersByTimeAsync(500);

    // Resolve both
    await Promise.all([p1, p2]);
    expect((hlsManager as any).sessions.has(sessionId)).toBe(true);
  });

  it('ensureSessionUnthrottled starts new session when not pending or existing', async () => {
    const sessionId = 'unthrottled-new';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSessionUnthrottled(sessionId, '/v.mp4');
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;

    expect(result).toContain('playlist.m3u8');
  });

  it('FFmpeg exit with code 0 and pinned sets COMPLETE status', async () => {
    const sessionId = 'pinned-exit';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    hlsManager.pinSession(sessionId);
    const promise = hlsManager.ensureSession(sessionId, '/v.mp4');
    await vi.advanceTimersByTimeAsync(500);

    mockProcess.emit('exit', 0, null);
    await promise;

    const session = (hlsManager as any).sessions.get(sessionId);
    expect(session.status).toBe('complete');
  });

  it('ensureSession throws when MAX_CONCURRENT_TRANSCODES is reached', async () => {
    // Fill up sessions to max (assuming MAX_CONCURRENT_TRANSCODES = 10 from constants.ts)
    for (let i = 0; i < 10; i++) {
      (hlsManager as any).sessions.set(`dummy-${i}`, {
        status: 'active',
        playlistPath: '/dummy',
        progress: {},
      });
    }
    await expect(hlsManager.ensureSession('new-id', '/v.mp4')).rejects.toThrow(
      'Server too busy. Please try again later.',
    );
  });

  it('ensureSessionUnthrottled reuses existing COMPLETE session', async () => {
    const sessionId = 'unthrottled-complete-reuse';
    (hlsManager as any).sessions.set(sessionId, {
      status: 'complete',
      playlistPath: '/tmp/out/playlist.m3u8',
      progress: {},
    });
    const result = await hlsManager.ensureSessionUnthrottled(
      sessionId,
      '/v.mp4',
    );
    expect(result).toBe('/tmp/out/playlist.m3u8');
  });

  it('stopSession handles fs.rm error safely in catch block', async () => {
    const sessionId = 'stop-rm-error';
    const mockProcess = createMockProcess();
    (hlsManager as any).sessions.set(sessionId, {
      id: sessionId,
      process: mockProcess,
      lastAccess: Date.now(),
      outputDir: '/tmp/error-out',
      playlistPath: '/tmp/error-out/playlist.m3u8',
      status: 'active',
      progress: {},
    });

    mockFsRm.mockRejectedValueOnce(new Error('Permission denied'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await hlsManager.stopSession(sessionId);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[HLS] Failed to clean up /tmp/error-out:',
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('waitForPlaylist rejects if FFmpeg exits normally but no playlist is found', async () => {
    const sessionId = 'no-playlist-exit';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);

    // Simulate FFmpeg exiting cleanly without creating the playlist
    mockProcess.emit('exit', 0, null);

    await expect(promise).rejects.toThrow(
      'HLS session finished but playlist not found',
    );
  });

  it('resetInstance cleans up active processes', () => {
    const sessionId = 'reset-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    (hlsManager as any).sessions.set(sessionId, {
      id: sessionId,
      process: mockProcess,
      lastAccess: Date.now(),
      outputDir: '/tmp/out',
      playlistPath: '/tmp/out/playlist.m3u8',
      status: 'active',
      progress: {},
      killTimeout: setTimeout(() => {}, 1000),
    });

    HlsManager.resetInstance();
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('waitForSession returns STOPPED if session does not exist', async () => {
    const status = await hlsManager.waitForSession('non-existent');
    expect(status).toBe('stopped');
  });

  it('waitForSession returns current status if already COMPLETE, ERROR, or STOPPED', async () => {
    const statuses = ['complete', 'error', 'stopped'];
    for (const status of statuses) {
      (hlsManager as any).sessions.set(`test-${status}`, {
        status: status,
      });
      const result = await hlsManager.waitForSession(`test-${status}`);
      expect(result).toBe(status);
    }
  });

  it('waitForSession waits for status event if session is ACTIVE or STARTING', async () => {
    const sessionId = 'wait-for-status';
    (hlsManager as any).sessions.set(sessionId, {
      status: 'active',
    });

    const promise = hlsManager.waitForSession(sessionId);

    // Emit an intermediate status, should not resolve yet
    (hlsManager as any).emit(`status:${sessionId}`, 'starting');

    // Emit final status
    (hlsManager as any).emit(`status:${sessionId}`, 'complete');

    const result = await promise;
    expect(result).toBe('complete');
  });
});
