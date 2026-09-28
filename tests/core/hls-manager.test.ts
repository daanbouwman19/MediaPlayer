import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import EventEmitter from 'events';
import path from 'path';

// vi.hoisted ensures these are available inside vi.mock factory closures
const {
  mockSpawn,
  mockFsMkdir,
  mockFsRm,
  mockFsStat,
  mockFsReaddir,
  mockFsAccess,
  mockFsReadFile,
  mockFsWriteFile,
  mockGetFFmpegStreams,
  mockGetSize,
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsRm: vi.fn(),
  mockFsStat: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsAccess: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsWriteFile: vi.fn(),
  mockGetFFmpegStreams: vi.fn(),
  mockGetSize: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

vi.mock('fs/promises', () => {
  const fsMock = {
    mkdir: mockFsMkdir,
    rm: mockFsRm,
    readdir: mockFsReaddir,
    stat: mockFsStat,
    access: mockFsAccess,
    readFile: mockFsReadFile,
    writeFile: mockFsWriteFile,
  };
  return { default: fsMock, ...fsMock };
});

vi.mock('../../src/core/media/media-source.ts', () => ({
  createMediaSource: vi.fn().mockImplementation((filePath: string) => ({
    getFFmpegInput: vi.fn().mockResolvedValue(filePath),
    getStream: vi.fn(),
    getMimeType: vi.fn(),
    getSize: mockGetSize,
    getType: () => 'local',
  })),
}));

vi.mock('../../src/infrastructure/ffmpeg-utils.ts', () => ({
  getHlsTranscodeArgs: vi.fn().mockReturnValue(['-f', 'hls', 'playlist.m3u8']),
  getFFmpegStreams: mockGetFFmpegStreams,
  canStreamCopy: vi.fn().mockReturnValue({ copyVideo: true, copyAudio: true }),
}));

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

import {
  HlsManager,
  HlsSessionStatus,
  HlsBusyError,
} from '../../src/core/media/hls-manager.ts';
import { MAX_CONCURRENT_TRANSCODES } from '../../src/core/media/constants.ts';

/** Size and modification time of every source file, unless a test changes them. */
const SOURCE_SIZE = 5000;
const SOURCE_MTIME = 1_700_000_000_123.25;

type MockProc = EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter;
  killed: boolean;
  pid: number;
};

/**
 * Behaves like a ChildProcess: `killed` turns true as soon as a signal is
 * sent, and 'close' follows unless SIGTERM is ignored.
 */
function createMockProcess(opts: { ignoreSigterm?: boolean } = {}): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.pid = 4321;
  proc.kill = vi.fn((signal: string = 'SIGTERM') => {
    proc.killed = true;
    if (signal === 'SIGTERM' && opts.ignoreSigterm) return true;
    queueMicrotask(() => proc.emit('close', null, signal));
    return true;
  });
  return proc;
}

describe('HlsManager lifecycle', () => {
  const CACHE_DIR = '/tmp/hls-robust';
  const dirOf = (id: string) => path.join(CACHE_DIR, id);
  let hlsManager: HlsManager;

  /** Starts a session whose playlist appears on the first poll. */
  async function startActive(id: string, proc = createMockProcess()) {
    mockSpawn.mockReturnValueOnce(proc);
    const promise = hlsManager.ensureSession(id, `/videos/${id}.mkv`);
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    return proc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
    vi.useFakeTimers();
    HlsManager.resetInstance();
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsReaddir.mockResolvedValue([]);
    // Nothing retained on disk by default
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    mockFsReadFile.mockRejectedValue(new Error('ENOENT'));
    // Playlist ready on the first poll by default
    mockFsStat.mockResolvedValue({
      size: 100,
      mtimeMs: SOURCE_MTIME,
      isDirectory: () => true,
    });
    mockGetSize.mockResolvedValue(SOURCE_SIZE);
    mockGetFFmpegStreams.mockResolvedValue({
      hasVideo: true,
      hasAudio: true,
      videoCodec: 'h264',
      audioCodec: 'aac',
      duration: 100,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    HlsManager.resetInstance();
  });

  it('prevents multiple spawns for the same session ID via locking', async () => {
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const p1 = hlsManager.ensureSession('test-session', '/test.mp4');
    const p2 = hlsManager.ensureSession('test-session', '/test.mp4');

    await vi.advanceTimersByTimeAsync(1);
    await p1;
    await p2;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('spawns ffmpeg without a console window', async () => {
    await startActive('hidden');
    expect(mockSpawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  it('cleans up and throws if FFmpeg fails during startup', async () => {
    mockFsStat.mockRejectedValue(new Error('ENOENT'));
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession('startup-fail', '/test.mp4');
    promise.catch(() => {}); // prevent unhandled rejection warning
    await vi.advanceTimersByTimeAsync(1);

    // Spawn failure: 'error', then 'close'
    mockProcess.emit('error', new Error('Execution failed'));
    mockProcess.emit('close', -2, null);
    await vi.advanceTimersByTimeAsync(600);

    await expect(promise).rejects.toThrow('Execution failed');
    // The half-written output directory is removed (F26)
    expect(mockFsRm).toHaveBeenLastCalledWith(
      dirOf('startup-fail'),
      expect.anything(),
    );
    expect(hlsManager.getSessionProgress('startup-fail')).toBeNull();
  });

  it('handles FFmpeg exit during playlist wait and reports its error lines', async () => {
    mockFsStat.mockRejectedValue(new Error('ENOENT'));
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession('exit-during-wait', '/test.mp4');
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(1);

    mockProcess.stderr.emit(
      'data',
      'Invalid data found when processing input\n',
    );
    mockProcess.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(600);

    await expect(promise).rejects.toThrow(
      'FFmpeg exited with code 1: Invalid data found when processing input',
    );
  });

  it('redacts proxy lease tokens from logged and reported ffmpeg errors (F78)', async () => {
    mockFsStat.mockRejectedValue(new Error('ENOENT'));
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const promise = hlsManager.ensureSession('token-leak', '/test.mp4');
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(1);

      mockProcess.stderr.emit(
        'data',
        'Error opening input file http://127.0.0.1:1234/stream/abc.mp4?token=abc123\n',
      );
      mockProcess.emit('close', 1, null);
      await vi.advanceTimersByTimeAsync(600);

      const error = await promise.then(
        () => null,
        (err: unknown) => err as Error,
      );
      expect(error?.message).toContain('?token=[redacted]');
      expect(error?.message).not.toContain('abc123');

      const logged = errorSpy.mock.calls.flat().map(String).join('\n');
      expect(logged).toContain('Error opening input file');
      expect(logged).not.toContain('abc123');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('times out if playlist is never created', async () => {
    mockFsStat.mockRejectedValue(new Error('ENOENT'));
    const mockProcess = createMockProcess();
    mockSpawn.mockReturnValue(mockProcess);

    const promise = hlsManager.ensureSession('timeout-playlist', '/test.mp4');
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(11000);

    await expect(promise).rejects.toThrow('Timeout waiting for HLS playlist');
    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  describe('progress (F31)', () => {
    it('seeds the duration from the probe and parses -stats lines', async () => {
      const proc = await startActive('progress-test');

      proc.stderr.emit(
        'data',
        'frame=  501 fps= 25 q=28.0 size=N/A time=00:00:50.00 bitrate=N/A speed=1.5x    \r',
      );

      const progress = hlsManager.getSessionProgress('progress-test');
      expect(progress?.duration).toBe(100);
      expect(progress?.currentTime).toBe(50);
      expect(progress?.percent).toBe(50);
      expect(progress?.fps).toBe(25);
      expect(progress?.speed).toBe('1.5x');
    });

    it('reports 100% and the full duration when ffmpeg finishes', async () => {
      const proc = await startActive('exit-duration');
      proc.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);

      const progress = hlsManager.getSessionProgress('exit-duration');
      expect(progress?.percent).toBe(100);
      expect(progress?.currentTime).toBe(100);
    });
  });

  describe('finished sessions (F03)', () => {
    it('marks a clean exit of an unpinned session COMPLETE', async () => {
      const proc = await startActive('done');
      proc.emit('close', 0, null);

      await expect(hlsManager.waitForSession('done')).resolves.toBe(
        HlsSessionStatus.COMPLETE,
      );
    });

    it('reuses a completed session instead of wiping it and transcoding again', async () => {
      const proc = await startActive('reuse');
      proc.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);
      const rmCalls = mockFsRm.mock.calls.length;

      // hls.js reloads the playlist after ffmpeg exited
      const playlist = await hlsManager.ensureSession('reuse', '/v.mkv');

      expect(playlist).toBe(path.join(dirOf('reuse'), 'playlist.m3u8'));
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockFsRm.mock.calls.length).toBe(rmCalls);
    });

    it('does not count completed sessions against the cap', async () => {
      for (const id of ['a', 'b']) {
        const proc = await startActive(id);
        proc.emit('close', 0, null);
      }
      await vi.advanceTimersByTimeAsync(0);

      await expect(startActive('c')).resolves.toBeDefined();
    });

    it("keeps a paused viewer's finished segments (no eager idle stop)", async () => {
      const proc = await startActive('paused');
      proc.emit('close', 0, null);
      mockFsRm.mockClear();
      hlsManager.acquireSession('paused');
      hlsManager.releaseSession('paused');

      await vi.advanceTimersByTimeAsync(60_000);

      expect(hlsManager.getSessionProgress('paused')).not.toBeNull();
      expect(mockFsRm).not.toHaveBeenCalledWith(
        dirOf('paused'),
        expect.anything(),
      );
    });

    it("an old session's idle timer does not stop its replacement", async () => {
      const first = await startActive('replaced');
      hlsManager.acquireSession('replaced');
      hlsManager.releaseSession('replaced'); // arms the 30 s idle timer
      // ffmpeg crashes; the next request retries with a new process
      first.emit('close', 1, null);
      await vi.advanceTimersByTimeAsync(0);
      const second = await startActive('replaced');

      await vi.advanceTimersByTimeAsync(31_000);

      expect(second.kill).not.toHaveBeenCalled();
      expect(hlsManager.getSessionProgress('replaced')).not.toBeNull();
    });
  });

  describe('fast finish (F10)', () => {
    it('does not reset a session that finished before the playlist poll to ACTIVE', async () => {
      // The playlist exists, but ffmpeg (stream copy of a short clip) exits
      // before the first poll result is seen.
      let resolveStat!: (v: unknown) => void;
      mockFsStat.mockImplementation(
        () => new Promise((resolve) => (resolveStat = resolve)),
      );
      const proc = createMockProcess();
      mockSpawn.mockReturnValue(proc);

      const promise = hlsManager.ensureSessionUnthrottled('short', '/s.mp4');
      await vi.advanceTimersByTimeAsync(0);
      proc.emit('close', 0, null);
      resolveStat({ size: 100 });
      await promise;

      // Must not hang: the session is COMPLETE, not ACTIVE without a process.
      await expect(hlsManager.waitForSession('short')).resolves.toBe(
        HlsSessionStatus.COMPLETE,
      );
    });
  });

  describe('stopping (F23, F113, F114)', () => {
    it('settles waiters with STOPPED when the session is stopped', async () => {
      await startActive('cancel-me');
      const waiting = hlsManager.waitForSession('cancel-me');

      await hlsManager.stopSession('cancel-me');

      await expect(waiting).resolves.toBe(HlsSessionStatus.STOPPED);
      expect(hlsManager.getSessionProgress('cancel-me')).toBeNull();
    });

    it('deletes the output only after ffmpeg has exited', async () => {
      const proc = await startActive('ordered');
      const order: string[] = [];
      proc.on('close', () => order.push('closed'));
      mockFsRm.mockImplementation(async () => {
        order.push('rm');
      });

      await hlsManager.stopSession('ordered');

      expect(order).toEqual(['closed', 'rm']);
    });

    it('escalates to SIGKILL when ffmpeg ignores SIGTERM (proc.killed is already true)', async () => {
      const proc = await startActive(
        'stubborn',
        createMockProcess({ ignoreSigterm: true }),
      );

      const stopping = hlsManager.stopSession('stubborn');
      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proc.killed).toBe(true);

      await vi.advanceTimersByTimeAsync(2001);
      expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
      await stopping;
    });

    it('does not send SIGKILL once ffmpeg has exited', async () => {
      const proc = await startActive('polite');
      await hlsManager.stopSession('polite');
      await vi.advanceTimersByTimeAsync(2001);
      expect(proc.kill).not.toHaveBeenCalledWith('SIGKILL');
    });

    it("an old process's late exit cannot corrupt the restarted session", async () => {
      const old = await startActive(
        'restart',
        createMockProcess({ ignoreSigterm: true }),
      );
      void hlsManager.stopSession('restart');

      const fresh = createMockProcess();
      mockSpawn.mockReturnValueOnce(fresh);
      const restarted = hlsManager.ensureSession(
        'restart',
        '/videos/restart.mkv',
      );
      await vi.advanceTimersByTimeAsync(100);
      // The new session waits for the old ffmpeg before reusing its directory
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2000); // SIGKILL escalation
      expect(old.kill).toHaveBeenCalledWith('SIGKILL');
      await restarted;
      expect(mockSpawn).toHaveBeenCalledTimes(2);

      // Late events from the old process are ignored
      old.stderr.emit('data', 'frame=1 time=00:00:99.00 speed=1x\n');
      old.emit('close', 1, null);
      await vi.advanceTimersByTimeAsync(0);
      expect(hlsManager.getSessionProgress('restart')?.currentTime).toBe(0);
      fresh.emit('close', 0, null);
      await expect(hlsManager.waitForSession('restart')).resolves.toBe(
        HlsSessionStatus.COMPLETE,
      );
    });

    it("a restarted session waits for the old session's pending output delete", async () => {
      await startActive('redo');
      const order: string[] = [];
      let finishOldRm: () => void = () => {};
      mockFsRm.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            order.push('old rm started');
            finishOldRm = () => {
              order.push('old rm done');
              resolve();
            };
          }),
      );
      const stopping = hlsManager.stopSession('redo');
      await vi.advanceTimersByTimeAsync(0);
      expect(order).toEqual(['old rm started']);

      mockFsRm.mockImplementation(async () => {
        order.push('new rm');
      });
      mockFsMkdir.mockImplementation(async () => {
        order.push('new mkdir');
      });
      mockSpawn.mockReturnValueOnce(createMockProcess());
      const restarted = hlsManager.ensureSession('redo', '/videos/redo.mkv');
      await vi.advanceTimersByTimeAsync(100);
      // Nothing touches the directory while the old delete is running
      expect(order).toEqual(['old rm started']);
      expect(mockSpawn).toHaveBeenCalledTimes(1);

      finishOldRm();
      await stopping;
      await vi.advanceTimersByTimeAsync(0);
      await restarted;
      expect(order).toEqual([
        'old rm started',
        'old rm done',
        'new rm',
        'new mkdir',
      ]);
      expect(mockSpawn).toHaveBeenCalledTimes(2);
    });

    it('a disk-only stop is awaited by a new session for the same id', async () => {
      let finishRm: () => void = () => {};
      mockFsRm.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishRm = resolve;
          }),
      );
      const stopping = hlsManager.stopSession('disk-only');
      await vi.advanceTimersByTimeAsync(0);

      mockSpawn.mockReturnValueOnce(createMockProcess());
      const started = hlsManager.ensureSession(
        'disk-only',
        '/videos/disk-only.mkv',
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(mockFsMkdir).not.toHaveBeenCalled();

      finishRm();
      await stopping;
      await vi.advanceTimersByTimeAsync(0);
      await started;
      expect(mockFsMkdir).toHaveBeenCalledWith(dirOf('disk-only'), {
        recursive: true,
      });
    });

    it('treats an external SIGKILL (OOM killer) as an error, not success', async () => {
      const proc = await startActive('oom');
      proc.emit('close', null, 'SIGKILL');

      await expect(hlsManager.waitForSession('oom')).resolves.toBe(
        HlsSessionStatus.ERROR,
      );
    });
  });

  describe('retained pre-transcodes (F25)', () => {
    const retainedPlaylist =
      '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:6.0,\nseg-000.ts\n#EXTINF:4.5,\nseg-001.ts\n#EXT-X-ENDLIST\n';
    const sourceMarker = JSON.stringify({
      size: SOURCE_SIZE,
      mtimeMs: SOURCE_MTIME,
    });

    /** Puts retained outputs in the cache directory, keyed by session id. */
    function retainedOnDisk(
      outputs: Record<string, { marker?: string; playlist?: string }>,
    ) {
      mockFsReadFile.mockImplementation(async (p: string) => {
        for (const [id, output] of Object.entries(outputs)) {
          if (p === path.join(dirOf(id), '.retained')) {
            return output.marker ?? sourceMarker;
          }
          if (p === path.join(dirOf(id), 'playlist.m3u8')) {
            return output.playlist ?? retainedPlaylist;
          }
        }
        throw new Error('ENOENT');
      });
    }

    /** Takes every interactive transcode slot with a session in use. */
    async function fillTranscodeSlots() {
      for (let i = 0; i < MAX_CONCURRENT_TRANSCODES; i++) {
        await startActive(`live-${i}`);
        hlsManager.acquireSession(`live-${i}`);
      }
    }

    it('writes the source identity into the marker and keeps the output when evicted', async () => {
      hlsManager.pinSession('movie');
      const proc = await startActive('movie');
      proc.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);

      mockFsRm.mockClear();
      await expect(
        hlsManager.retainSession('movie', '/videos/movie.mkv'),
      ).resolves.toBe(true);
      hlsManager.unpinSession('movie');
      expect(mockFsStat).toHaveBeenCalledWith('/videos/movie.mkv');
      expect(mockFsWriteFile).toHaveBeenCalledWith(
        path.join(dirOf('movie'), '.retained'),
        sourceMarker,
      );

      // Idle sweep after 5 minutes drops it from memory only
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(hlsManager.getSessionProgress('movie')).toBeNull();
      expect(mockFsRm).not.toHaveBeenCalledWith(
        dirOf('movie'),
        expect.anything(),
      );
    });

    it('identifies a Drive file by its size only', async () => {
      const proc = await startActive('drive');
      proc.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);

      await hlsManager.retainSession('drive', 'gdrive://file-1');

      const driveMarker = JSON.stringify({ size: SOURCE_SIZE });
      expect(mockFsWriteFile).toHaveBeenCalledWith(
        path.join(dirOf('drive'), '.retained'),
        driveMarker,
      );
      expect(mockFsStat).not.toHaveBeenCalledWith('gdrive://file-1');

      retainedOnDisk({ 'drive-2': { marker: driveMarker } });
      await hlsManager.ensureSession('drive-2', 'gdrive://file-2');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('cannot retain a session that has not completed', async () => {
      await startActive('running');
      await expect(
        hlsManager.retainSession('running', '/videos/running.mkv'),
      ).resolves.toBe(false);
      await expect(
        hlsManager.retainSession('missing', '/videos/missing.mkv'),
      ).resolves.toBe(false);
    });

    it('does not retain a session stopped while its source is read', async () => {
      const proc = await startActive('cleared-early');
      proc.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);
      let resolveSize!: (size: number) => void;
      mockGetSize.mockImplementationOnce(
        () => new Promise((resolve) => (resolveSize = resolve)),
      );

      const retaining = hlsManager.retainSession(
        'cleared-early',
        '/videos/cleared-early.mkv',
      );
      await hlsManager.stopSession('cleared-early');
      resolveSize(SOURCE_SIZE);

      await expect(retaining).resolves.toBe(false);
      expect(mockFsWriteFile).not.toHaveBeenCalled();
    });

    it('reuses a retained output from disk (e.g. after a restart) without transcoding', async () => {
      retainedOnDisk({ adopt: {} });

      const playlist = await hlsManager.ensureSession('adopt', '/v.mkv');

      expect(playlist).toBe(path.join(dirOf('adopt'), 'playlist.m3u8'));
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockFsRm).not.toHaveBeenCalled();
      expect(hlsManager.getSessionProgress('adopt')).toMatchObject({
        duration: 10.5,
        percent: 100,
      });
      await expect(hlsManager.waitForSession('adopt')).resolves.toBe(
        HlsSessionStatus.COMPLETE,
      );
    });

    it.each([
      ['size', { size: SOURCE_SIZE + 1, mtimeMs: SOURCE_MTIME }],
      ['modification time', { size: SOURCE_SIZE, mtimeMs: SOURCE_MTIME - 1 }],
    ])(
      'transcodes again when the file has a different %s since',
      async (_, source) => {
        // e.g. a re-download or a quality upgrade at the same path
        retainedOnDisk({ replaced: { marker: JSON.stringify(source) } });

        await startActive('replaced');

        expect(mockSpawn).toHaveBeenCalledTimes(1);
        expect(mockFsRm).toHaveBeenCalledWith(
          dirOf('replaced'),
          expect.anything(),
        );
      },
    );

    it.each([
      '',
      'not json',
      'null',
      '5000',
      '{"mtimeMs":1}',
      '{"size":"5000"}',
      '{"size":5000,"mtimeMs":null}',
    ])('does not reuse an output whose marker is %j', async (marker) => {
      retainedOnDisk({ bad: { marker } });

      await startActive('bad');

      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('does not reuse an unfinished output even if it is marked', async () => {
      retainedOnDisk({
        partial: { playlist: '#EXTM3U\n#EXTINF:6.0,\nseg-000.ts\n' },
      });

      await startActive('partial');

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(mockFsRm).toHaveBeenCalledWith(
        dirOf('partial'),
        expect.anything(),
      );
    });

    it('keeps a retained output when its source cannot be read', async () => {
      retainedOnDisk({ offline: {} });
      mockGetSize.mockRejectedValueOnce(new Error('Drive unavailable'));

      await expect(
        hlsManager.ensureSession('offline', 'gdrive://offline'),
      ).rejects.toThrow('Drive unavailable');

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockFsRm).not.toHaveBeenCalled();
    });

    it('init keeps retained outputs and deletes everything else', async () => {
      mockFsReaddir.mockResolvedValue([
        'kept',
        'partial',
        'bad-marker',
        'file.txt',
      ]);
      mockFsStat.mockImplementation(async (p: string) => ({
        isDirectory: () => !p.endsWith('file.txt'),
      }));
      retainedOnDisk({ kept: {}, 'bad-marker': { marker: '' } });

      await hlsManager.init(CACHE_DIR);

      expect(mockFsRm).toHaveBeenCalledTimes(2);
      expect(mockFsRm).toHaveBeenCalledWith(
        dirOf('partial'),
        expect.anything(),
      );
      expect(mockFsRm).toHaveBeenCalledWith(
        dirOf('bad-marker'),
        expect.anything(),
      );
    });

    it('an explicit stop (Clear HLS) deletes a retained output that is only on disk', async () => {
      await hlsManager.stopSession('cleared');
      expect(mockFsRm).toHaveBeenCalledWith(
        dirOf('cleared'),
        expect.anything(),
      );
    });

    describe('and the interactive transcode cap', () => {
      it('plays a retained output found at startup while every slot is taken', async () => {
        mockFsReaddir.mockResolvedValue(['third']);
        retainedOnDisk({ third: {} });
        await hlsManager.init(CACHE_DIR);
        await fillTranscodeSlots();

        await expect(
          hlsManager.ensureSession('third', '/videos/third.mkv'),
        ).resolves.toBe(path.join(dirOf('third'), 'playlist.m3u8'));

        expect(mockSpawn).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSCODES);
        await expect(hlsManager.waitForSession('third')).resolves.toBe(
          HlsSessionStatus.COMPLETE,
        );
      });

      it('plays a pre-transcode swept from memory while every slot is taken', async () => {
        hlsManager.pinSession('movie');
        const proc = await startActive('movie');
        proc.emit('close', 0, null);
        await vi.advanceTimersByTimeAsync(0);
        await hlsManager.retainSession('movie', '/videos/movie.mkv');
        hlsManager.unpinSession('movie');
        await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
        expect(hlsManager.getSessionProgress('movie')).toBeNull();
        retainedOnDisk({ movie: {} });
        await fillTranscodeSlots();

        await expect(
          hlsManager.ensureSession('movie', '/videos/movie.mkv'),
        ).resolves.toBeDefined();

        expect(mockSpawn).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSCODES + 1);
      });

      it('applies the cap when the retained output turns out to be stale', async () => {
        mockFsReaddir.mockResolvedValue(['stale']);
        retainedOnDisk({ stale: { marker: JSON.stringify({ size: 1 }) } });
        await hlsManager.init(CACHE_DIR);
        await fillTranscodeSlots();
        mockFsRm.mockClear();

        await expect(
          hlsManager.ensureSession('stale', '/videos/stale.mkv'),
        ).rejects.toBeInstanceOf(HlsBusyError);

        expect(mockSpawn).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSCODES);
        expect(mockFsRm).not.toHaveBeenCalled();
      });

      it('counts a stale retained output against the cap once it transcodes', async () => {
        mockFsReaddir.mockResolvedValue(['stale']);
        retainedOnDisk({ stale: { marker: JSON.stringify({ size: 1 }) } });
        await hlsManager.init(CACHE_DIR);
        for (let i = 1; i < MAX_CONCURRENT_TRANSCODES; i++) {
          await startActive(`live-${i}`);
        }

        await startActive('stale');

        expect(mockSpawn).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSCODES);
        await expect(
          hlsManager.ensureSession('next', '/videos/next.mkv'),
        ).rejects.toBeInstanceOf(HlsBusyError);
      });

      it('Clear HLS forgets a retained output, so it needs a slot again', async () => {
        mockFsReaddir.mockResolvedValue(['cleared']);
        retainedOnDisk({ cleared: {} });
        await hlsManager.init(CACHE_DIR);
        await hlsManager.stopSession('cleared');
        await fillTranscodeSlots();

        await expect(
          hlsManager.ensureSession('cleared', '/videos/cleared.mkv'),
        ).rejects.toBeInstanceOf(HlsBusyError);
      });
    });
  });

  describe('shutdown (F26)', () => {
    it('stopAll kills every ffmpeg, waits for it and deletes unfinished output', async () => {
      const a = await startActive('a');
      hlsManager.pinSession('bg');
      const bg = createMockProcess();
      mockSpawn.mockReturnValueOnce(bg);
      await hlsManager.ensureSessionUnthrottled('bg', '/bg.mkv');

      await hlsManager.stopAll();

      expect(a.kill).toHaveBeenCalledWith('SIGTERM');
      expect(bg.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockFsRm).toHaveBeenCalledWith(dirOf('a'), expect.anything());
      expect(mockFsRm).toHaveBeenCalledWith(dirOf('bg'), expect.anything());
      expect(hlsManager.getSessionProgress('a')).toBeNull();
    });

    it('stopAll keeps retained outputs', async () => {
      const proc = await startActive('keep');
      proc.emit('close', 0, null);
      await vi.advanceTimersByTimeAsync(0);
      await hlsManager.retainSession('keep', '/videos/keep.mkv');
      mockFsRm.mockClear();

      await hlsManager.stopAll();

      expect(mockFsRm).not.toHaveBeenCalledWith(
        dirOf('keep'),
        expect.anything(),
      );
    });

    it('refuses new sessions after stopAll', async () => {
      await hlsManager.stopAll();
      await expect(hlsManager.ensureSession('late', '/v.mkv')).rejects.toThrow(
        'shutting down',
      );
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('stopping during startup never spawns ffmpeg', async () => {
      let resolveProbe!: (v: unknown) => void;
      mockGetFFmpegStreams.mockImplementation(
        () => new Promise((resolve) => (resolveProbe = resolve)),
      );
      const promise = hlsManager.ensureSession('early', '/v.mkv');
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(0);

      await hlsManager.stopAll();
      resolveProbe({ hasVideo: true, hasAudio: true });

      await expect(promise).rejects.toThrow('HLS session was stopped');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  it('performs startup cleanup of orphaned directories', async () => {
    mockFsReaddir.mockResolvedValue([
      'session-1',
      'session-2',
      'not-a-session',
    ]);
    mockFsStat.mockResolvedValue({ isDirectory: () => true });

    await hlsManager.init(CACHE_DIR);

    expect(mockFsRm).toHaveBeenCalledTimes(3);
    expect(mockFsRm).toHaveBeenCalledWith(
      dirOf('session-1'),
      expect.anything(),
    );
    expect(mockFsRm).toHaveBeenCalledWith(
      dirOf('session-2'),
      expect.anything(),
    );
  });

  it('init without an argument uses the configured cache dir', async () => {
    mockFsReaddir.mockResolvedValue(['old']);
    mockFsStat.mockResolvedValue({ isDirectory: () => true });

    await hlsManager.init();

    expect(mockFsReaddir).toHaveBeenCalledWith(CACHE_DIR);
    expect(mockFsRm).toHaveBeenCalledWith(dirOf('old'), expect.anything());
  });

  it('cleanup interval stops inactive sessions', async () => {
    const mockProcess = await startActive('timeout-test');

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

    expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    expect(hlsManager.getSessionProgress('timeout-test')).toBeNull();
  });

  it('ensureSession reuses active session', async () => {
    await startActive('reuse-test');
    await hlsManager.ensureSession('reuse-test', '/test.mp4');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('retries a failed session from scratch', async () => {
    const first = await startActive('flaky');
    first.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(0);
    await expect(hlsManager.waitForSession('flaky')).resolves.toBe(
      HlsSessionStatus.ERROR,
    );

    await startActive('flaky');

    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(hlsManager.getSessionProgress('flaky')).not.toBeNull();
  });
});
