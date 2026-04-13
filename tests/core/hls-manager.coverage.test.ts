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
  getFFmpegStreams: vi
    .fn()
    .mockResolvedValue({ hasVideo: true, hasAudio: true }),
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
    mockProcess.stderr.emit('data', '0.00\nfps=30\n');

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

    expect(mockFsRm).toHaveBeenCalledTimes(2);
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

  it('resetInstance cleans up active processes', () => {
    const sessionId = 'reset-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // We need to bypass some things to get a session in there without full async flow if possible,
    // or just run a full one.
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
});
