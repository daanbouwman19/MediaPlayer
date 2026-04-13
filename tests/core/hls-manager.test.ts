import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';

// vi.hoisted ensures these are available inside vi.mock factory closures
const {
  mockSpawn,
  mockFsMkdir,
  mockFsRm,
  mockFsStat,
  mockFsReaddir,
  mockFsAccess,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsRm: vi.fn(),
  mockFsStat: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsAccess: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: mockFsMkdir,
    access: mockFsAccess,
    rm: mockFsRm,
    readdir: mockFsReaddir,
    stat: mockFsStat,
  },
  mkdir: mockFsMkdir,
  access: mockFsAccess,
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

describe('HlsManager Robustness', () => {
  const CACHE_DIR = '/tmp/hls-robust';
  let hlsManager: HlsManager;

  const createMockProcess = () => {
    const proc = new EventEmitter() as NodeJS.EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      stderr: EventEmitter;
      stdin: EventEmitter;
      stdout: EventEmitter;
      killed: boolean;
    };
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
    // access resolves → playlist ready
    mockFsAccess.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    HlsManager.resetInstance();
  });

  it('prevents multiple spawns for the same session ID via locking', async () => {
    const sessionId = 'test-session';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    const p2 = hlsManager.ensureSession(sessionId, '/test.mp4');

    await vi.advanceTimersByTimeAsync(1);
    await p1;
    await p2;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('cleans up and throws if FFmpeg fails during startup', async () => {
    const sessionId = 'startup-fail';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    // Playlist never appears
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    promise.catch(() => {}); // prevent unhandled rejection warning

    await vi.advanceTimersByTimeAsync(1);

    // Trigger FFmpeg error
    mockProcess.emit('error', new Error('Execution failed'));

    await vi.advanceTimersByTimeAsync(600);

    await expect(promise).rejects.toThrow('Execution failed');
    expect(mockFsRm).toHaveBeenCalledWith(
      expect.stringContaining(sessionId),
      expect.anything(),
    );
  });

  it('handles FFmpeg exit during playlist wait', async () => {
    const sessionId = 'exit-during-wait';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    promise.catch(() => {}); // prevent unhandled rejection warning

    await vi.advanceTimersByTimeAsync(1);
    mockProcess.emit('exit', 1, null);

    await vi.advanceTimersByTimeAsync(600);

    await expect(promise).rejects.toThrow('FFmpeg exited with code 1');
  });

  it('parses duration and progress correctly from stderr', async () => {
    const sessionId = 'progress-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(100);

    mockProcess.stderr.emit('data', 'Duration: 00:01:40.00\n');
    mockProcess.stderr.emit('data', 'time=00:00:50.00\n');

    await vi.advanceTimersByTimeAsync(500);
    await promise;

    const progress = hlsManager.getSessionProgress(sessionId);
    expect(progress?.duration).toBe(100);
    expect(progress?.currentTime).toBe(50);
    expect(progress?.percent).toBe(50);
  });

  it('performs startup cleanup of orphaned directories', async () => {
    vi.clearAllMocks();
    mockFsReaddir.mockResolvedValue([
      'session-1',
      'session-2',
      'not-a-session',
    ]);
    mockFsStat.mockResolvedValue({ isDirectory: () => true });

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
  });

  it('times out if playlist is never created', async () => {
    const sessionId = 'timeout-playlist';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession(sessionId, '/test.mp4');
    promise.catch(() => {}); // prevent unhandled rejection warning

    await vi.advanceTimersByTimeAsync(11000);

    await expect(promise).rejects.toThrow('Timeout waiting for HLS playlist');
    expect(mockProcess.kill).toHaveBeenCalled();
  });

  it('cleanup interval stops inactive sessions', async () => {
    const sessionId = 'timeout-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const promise = hlsManager.ensureSession(sessionId, '/file.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

    await (hlsManager as any).cleanup();

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('ensureSession reuses active session', async () => {
    const sessionId = 'reuse-test';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    await hlsManager.ensureSession(sessionId, '/test.mp4');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('proc exit success sets currentTime to duration if duration > 0', async () => {
    const sessionId = 'exit-duration';
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const p1 = hlsManager.ensureSession(sessionId, '/test.mp4');
    await vi.advanceTimersByTimeAsync(500);
    await p1;

    mockProcess.stderr.emit('data', 'Duration: 01:00:00.00\n');
    mockProcess.emit('exit', 0, null);

    const progress = hlsManager.getSessionProgress(sessionId);
    expect(progress?.percent).toBe(100);
    expect(progress?.currentTime).toBe(3600);
  });
});
