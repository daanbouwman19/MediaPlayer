import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HlsManager } from '../../src/core/hls-manager.ts';
import { MAX_CONCURRENT_TRANSCODES } from '../../src/core/constants.ts';
import EventEmitter from 'events';

const { mockSpawn, mockFsMkdir, mockFsRm, mockFsStat } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsRm: vi.fn(),
  mockFsStat: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: mockFsMkdir,
    rm: mockFsRm,
    stat: mockFsStat,
    readdir: vi.fn().mockResolvedValue([]),
  },
  mkdir: mockFsMkdir,
  rm: mockFsRm,
  stat: mockFsStat,
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

vi.mock('../../src/core/media-source.ts', () => ({
  createMediaSource: vi.fn(),
}));

import { createMediaSource } from '../../src/core/media-source.ts';

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

describe('HlsManager DOS Protection', () => {
  const CACHE_DIR = '/tmp/hls-dos';
  let hlsManager: HlsManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    HlsManager.resetInstance();
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    // Default fs behavior — stat resolves immediately so playlist wait exits
    mockFsStat.mockResolvedValue({ size: 100, isDirectory: () => true } as any);
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);

    vi.mocked(createMediaSource).mockImplementation((path: string) => ({
      getFFmpegInput: vi.fn().mockResolvedValue(path),
      getStream: vi.fn(),
      getMimeType: vi.fn(),
      getSize: vi.fn(),
      getType: () => 'local',
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    HlsManager.resetInstance();
  });

  it('enforces max concurrent sessions limit (DOS PREVENTION)', async () => {
    const limit = MAX_CONCURRENT_TRANSCODES;

    mockSpawn.mockImplementation(() => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.kill = vi.fn();
      mockProcess.stderr = new EventEmitter();
      mockProcess.exitCode = null;
      mockProcess.killed = false;
      return mockProcess;
    });

    // Fill the slots up to the limit
    const promises = [];
    for (let i = 0; i < limit; i++) {
      promises.push(
        hlsManager.ensureSession(`session-${i}`, `/path/file-${i}.mp4`),
      );
    }

    // Advance timers so all can finish waitForPlaylist
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(promises);

    // Exactly `limit` spawns should have occurred
    expect(mockSpawn).toHaveBeenCalledTimes(limit);
  });

  it('queues sessions beyond concurrency limit rather than spawning immediately', async () => {
    const limit = MAX_CONCURRENT_TRANSCODES;

    // block — playlist never appears until we advance time more
    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    mockSpawn.mockImplementation(() => {
      const mockProcess = new EventEmitter() as any;
      mockProcess.kill = vi.fn();
      mockProcess.stderr = new EventEmitter();
      mockProcess.exitCode = null;
      mockProcess.killed = false;
      return mockProcess;
    });

    // kick off limit+1 sessions concurrently
    const extra = limit + 1;
    const promises = Array.from({ length: extra }, (_, i) =>
      hlsManager
        .ensureSession(`session-${i}`, `/path/file-${i}.mp4`)
        .catch(() => null),
    );

    // Let the first batch start
    await vi.advanceTimersByTimeAsync(1);

    // Only `limit` spawns should have happened yet (queue holds the rest)
    expect(mockSpawn.mock.calls.length).toBeLessThanOrEqual(limit);

    // Clean up: timeout all waiting sessions
    await vi.advanceTimersByTimeAsync(30000);
    await Promise.all(promises);
  });
});
