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
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    HlsManager.resetInstance();
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    // Default fs behavior
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

    // 1. Fill the slots up to the limit
    const promises = [];
    for (let i = 0; i < limit; i++) {
      promises.push(
        hlsManager.ensureSession(`session-${i}`, `/path/file-${i}.mp4`),
      );
    }

    // Advance timers so they all can finish waitForPlaylist
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(promises);

    expect(mockSpawn).toHaveBeenCalledTimes(limit);

    // 2. Try to add one more
    await expect(
      hlsManager.ensureSession(`session-${limit}`, `/path/file-${limit}.mp4`),
    ).rejects.toThrow('Server too busy');

    // 3. Ensure no new spawn occurred
    expect(mockSpawn).toHaveBeenCalledTimes(limit);
  });
});
