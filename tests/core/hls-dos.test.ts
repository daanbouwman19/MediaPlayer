import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { HlsManager, HlsBusyError } from '../../src/core/media/hls-manager.ts';
import { MAX_CONCURRENT_TRANSCODES } from '../../src/core/media/constants.ts';
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
    // Nothing retained on disk
    access: vi.fn().mockRejectedValue(new Error('ENOENT')),
    readFile: vi.fn().mockRejectedValue(new Error('ENOENT')),
  },
  mkdir: mockFsMkdir,
  rm: mockFsRm,
  stat: mockFsStat,
  readdir: vi.fn().mockResolvedValue([]),
}));

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

vi.mock('../../src/core/media/media-source.ts', () => ({
  createMediaSource: vi.fn(),
}));

import { createMediaSource } from '../../src/core/media/media-source.ts';

vi.mock('../../src/infrastructure/ffmpeg-utils.ts', () => ({
  getHlsTranscodeArgs: vi.fn().mockReturnValue(['-f', 'hls', 'playlist.m3u8']),
  getFFmpegStreams: vi.fn().mockResolvedValue({
    hasVideo: true,
    hasAudio: true,
    videoCodec: 'h264',
    audioCodec: 'aac',
  }),
  canStreamCopy: vi.fn().mockReturnValue({ copyVideo: true, copyAudio: true }),
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

  describe('interactive transcode cap (F22)', () => {
    const makeProcess = () => {
      const proc = new EventEmitter() as any;
      proc.stderr = new EventEmitter();
      proc.killed = false;
      proc.kill = vi.fn((signal: string) => {
        proc.killed = true;
        queueMicrotask(() => proc.emit('close', null, signal));
        return true;
      });
      return proc;
    };

    beforeEach(() => {
      mockSpawn.mockReset();
      mockSpawn.mockImplementation(makeProcess);
    });

    async function start(id: string) {
      const promise = hlsManager.ensureSession(id, `/path/${id}.mkv`);
      promise.catch(() => {}); // awaited below
      await vi.advanceTimersByTimeAsync(0);
      return promise;
    }

    it('refuses parallel requests for different files beyond the cap', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          hlsManager.ensureSession(`parallel-${i}`, `/path/p-${i}.mkv`),
        ),
      );
      await vi.advanceTimersByTimeAsync(0);

      const refused = results.filter((r) => r.status === 'rejected');
      expect(refused).toHaveLength(20 - MAX_CONCURRENT_TRANSCODES);
      for (const r of refused) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
          HlsBusyError,
        );
      }
      expect(mockSpawn).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSCODES);
    });

    it('does not count stopped, failed or finished sessions', async () => {
      await start('stopped');
      await hlsManager.stopSession('stopped');
      await start('failed');
      mockSpawn.mock.results[1]!.value.emit('close', 1, null);
      await start('finished');
      mockSpawn.mock.results[2]!.value.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);

      await expect(start('a')).resolves.toBeDefined();
      await expect(start('b')).resolves.toBeDefined();
      await expect(start('c')).rejects.toBeInstanceOf(HlsBusyError);
    });

    it('does not count pinned background sessions', async () => {
      hlsManager.pinSession('bg-1');
      hlsManager.pinSession('bg-2');
      await hlsManager.ensureSessionUnthrottled('bg-1', '/bg1.mkv');
      await hlsManager.ensureSessionUnthrottled('bg-2', '/bg2.mkv');

      await expect(start('a')).resolves.toBeDefined();
      await expect(start('b')).resolves.toBeDefined();
    });

    it('evicts the least recently used idle session to make room', async () => {
      await start('old');
      await vi.advanceTimersByTimeAsync(5_000);
      await start('newer');
      // Neither is being fetched from, and 'old' has had no request for a while
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(start('next')).resolves.toBeDefined();

      const oldProc = mockSpawn.mock.results[0]!.value;
      const newerProc = mockSpawn.mock.results[1]!.value;
      expect(oldProc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(newerProc.kill).not.toHaveBeenCalled();
      expect(hlsManager.getSessionProgress('old')).toBeNull();
    });

    it('never evicts a session that is serving a request or was just used', async () => {
      await start('busy');
      await start('recent');
      hlsManager.acquireSession('busy');
      await vi.advanceTimersByTimeAsync(20_000);
      hlsManager.touchSession('recent');

      await expect(start('next')).rejects.toBeInstanceOf(HlsBusyError);
      expect(hlsManager.getSessionProgress('busy')).not.toBeNull();
      expect(hlsManager.getSessionProgress('recent')).not.toBeNull();
    });
  });
});
