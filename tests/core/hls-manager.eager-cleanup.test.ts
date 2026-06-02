import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EventEmitter from 'events';

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

vi.mock('../../src/core/media/media-source.ts', () => ({
  createMediaSource: vi.fn().mockImplementation((filePath: string) => ({
    getFFmpegInput: vi.fn().mockResolvedValue(filePath),
    getStream: vi.fn(),
    getMimeType: vi.fn(),
    getSize: vi.fn(),
    getType: () => 'local',
  })),
}));

vi.mock('../../src/infrastructure/ffmpeg-utils.ts', () => ({
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

import { HlsManager } from '../../src/core/media/hls-manager.ts';

type MockProc = NodeJS.EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter;
  stdin: EventEmitter;
  stdout: EventEmitter;
  killed: boolean;
};

function makeProc(): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.kill = vi.fn();
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.killed = false;
  return proc;
}

describe('HlsManager eager-cleanup via consumer refcount', () => {
  let hls: HlsManager;
  let currentProc: MockProc;

  beforeEach(() => {
    vi.useFakeTimers();
    HlsManager.resetInstance();
    hls = HlsManager.getInstance();
    hls.setCacheDir('/tmp/hls-eager');
    currentProc = makeProc();
    mockSpawn.mockReset();
    mockSpawn.mockReturnValue(currentProc);
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);
    // Make waitForPlaylist resolve on the first stat call.
    mockFsStat.mockResolvedValue({ size: 1, isDirectory: () => false } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
    HlsManager.resetInstance();
  });

  async function startSession(id: string, filePath = '/tmp/x.mp4') {
    const promise = hls.ensureSession(id, filePath);
    // Allow the spawn + waitForPlaylist promise chain to settle without
    // advancing the eager-idle timer prematurely.
    await vi.advanceTimersByTimeAsync(0);
    await promise;
  }

  it('does not stop the session while a consumer is held', async () => {
    await startSession('s1');
    hls.acquireSession('s1');

    await vi.advanceTimersByTimeAsync(60_000);

    expect(currentProc.kill).not.toHaveBeenCalled();
    expect(hls.getSessionProgress('s1')).not.toBeNull();
  });

  it('schedules teardown after the grace period when consumers reach zero', async () => {
    await startSession('s1');
    hls.acquireSession('s1');
    hls.releaseSession('s1');

    // Just before grace expires — still alive.
    await vi.advanceTimersByTimeAsync(29_000);
    expect(currentProc.kill).not.toHaveBeenCalled();

    // After grace — teardown fires.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(currentProc.kill).toHaveBeenCalled();
    expect(hls.getSessionProgress('s1')).toBeNull();
  });

  it('cancels pending teardown when a new consumer arrives', async () => {
    await startSession('s1');
    hls.acquireSession('s1');
    hls.releaseSession('s1');

    await vi.advanceTimersByTimeAsync(10_000);
    // New request comes in.
    hls.acquireSession('s1');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(currentProc.kill).not.toHaveBeenCalled();
    expect(hls.getSessionProgress('s1')).not.toBeNull();
  });

  it('release without prior acquire is a no-op (no negative refcount)', async () => {
    await startSession('s1');
    hls.releaseSession('s1');
    hls.releaseSession('s1');
    // Should still tear down after grace (consumers stayed at 0).
    await vi.advanceTimersByTimeAsync(31_000);
    expect(currentProc.kill).toHaveBeenCalled();
  });

  it('does not tear down pinned sessions on release', async () => {
    await startSession('s1');
    hls.pinSession('s1');
    hls.acquireSession('s1');
    hls.releaseSession('s1');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(currentProc.kill).not.toHaveBeenCalled();
  });

  it('multiple consumers: only the last release schedules teardown', async () => {
    await startSession('s1');
    hls.acquireSession('s1');
    hls.acquireSession('s1');

    hls.releaseSession('s1');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(currentProc.kill).not.toHaveBeenCalled();

    hls.releaseSession('s1');
    await vi.advanceTimersByTimeAsync(31_000);
    expect(currentProc.kill).toHaveBeenCalled();
  });
});
