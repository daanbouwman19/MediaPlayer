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
} = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockFsMkdir: vi.fn(),
  mockFsRm: vi.fn(),
  mockFsStat: vi.fn(),
  mockFsReaddir: vi.fn(),
  mockFsAccess: vi.fn(),
  mockFsReadFile: vi.fn(),
  mockFsWriteFile: vi.fn(),
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
    getSize: vi.fn().mockResolvedValue(100),
    getType: () => 'local',
  })),
}));

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

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

import {
  HlsManager,
  HlsSessionStatus,
  HlsBusyError,
} from '../../src/core/media/hls-manager.ts';

describe('HlsManager Coverage Boost', () => {
  const CACHE_DIR = '/tmp/hls-coverage';
  let hlsManager: HlsManager;

  const createMockProcess = () => {
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

  async function start(id: string, unthrottled = false) {
    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);
    const promise = unthrottled
      ? hlsManager.ensureSessionUnthrottled(id, `/${id}.mkv`)
      : hlsManager.ensureSession(id, `/${id}.mkv`);
    promise.catch(() => {}); // awaited below
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    return proc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Also drops queued mockReturnValueOnce values left by a refused start
    mockSpawn.mockReset();
    vi.useFakeTimers();
    HlsManager.resetInstance();
    hlsManager = HlsManager.getInstance();
    hlsManager.setCacheDir(CACHE_DIR);

    mockFsMkdir.mockResolvedValue(undefined);
    mockFsRm.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));
    mockFsReadFile.mockRejectedValue(new Error('ENOENT'));
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

  it('ensureSessionUnthrottled throws if cacheDir not set', async () => {
    (hlsManager as any).cacheDir = null;
    await expect(
      hlsManager.ensureSessionUnthrottled('id', '/v.mp4'),
    ).rejects.toThrow('HlsManager: cacheDir not set');
  });

  it('getSessionDir returns null if cacheDir not set', () => {
    (hlsManager as any).cacheDir = null;
    expect(hlsManager.getSessionDir('test')).toBeNull();
  });

  it('init without a cache dir does nothing', async () => {
    (hlsManager as any).cacheDir = null;
    await hlsManager.init();
    expect(mockFsReaddir).not.toHaveBeenCalled();
  });

  it('getSessionProgress returns null if session not found', () => {
    expect(hlsManager.getSessionProgress('non-existent')).toBeNull();
  });

  it('touch/acquire/release do nothing if session not found', () => {
    expect(() => hlsManager.touchSession('non-existent')).not.toThrow();
    expect(() => hlsManager.acquireSession('non-existent')).not.toThrow();
    expect(() => hlsManager.releaseSession('non-existent')).not.toThrow();
  });

  it('touchSession refreshes lastAccess so the sweep keeps the session', async () => {
    const proc = await start('touched');
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    hlsManager.touchSession('touched');
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('stopSession without a cache dir or session does nothing', async () => {
    (hlsManager as any).cacheDir = null;
    await expect(hlsManager.stopSession('non-existent')).resolves.toBe(
      undefined,
    );
    expect(mockFsRm).not.toHaveBeenCalled();
  });

  it('stopSession logs a failed directory removal', async () => {
    await start('stop-rm-error');
    mockFsRm.mockRejectedValueOnce(new Error('Permission denied'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await hlsManager.stopSession('stop-rm-error');

    expect(consoleSpy).toHaveBeenCalledWith(
      `[HLS] Failed to clean up ${path.join(CACHE_DIR, 'stop-rm-error')}:`,
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });

  it('stopSession logs a failed removal of an on-disk-only output', async () => {
    mockFsRm.mockRejectedValueOnce(new Error('Permission denied'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await hlsManager.stopSession('disk-only');

    expect(consoleSpy).toHaveBeenCalledWith(
      `[HLS] Failed to clean up ${path.join(CACHE_DIR, 'disk-only')}:`,
      expect.any(Error),
    );
    consoleSpy.mockRestore();
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

  it('cleanupOrphanedSessions is silent when the cache dir does not exist yet', async () => {
    mockFsReaddir.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await hlsManager.init(CACHE_DIR);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('cleanupOrphanedSessions skips directories of live sessions', async () => {
    await start('live');
    mockFsRm.mockClear();
    mockFsReaddir.mockResolvedValue(['live']);

    await hlsManager.init(CACHE_DIR);

    expect(mockFsRm).not.toHaveBeenCalled();
  });

  it('a session started during the orphan cleanup waits for its directory delete', async () => {
    const orphanDir = path.join(CACHE_DIR, 'orphan');
    let finishRm!: () => void;
    // Only the orphan cleanup's delete is held; the session's own rm is not.
    mockFsRm.mockImplementationOnce(
      (dir: string) =>
        new Promise<void>((resolve) => {
          expect(dir).toBe(orphanDir);
          finishRm = resolve;
        }),
    );
    mockFsReaddir.mockResolvedValue(['orphan']);

    const initPromise = hlsManager.init(CACHE_DIR);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFsRm).toHaveBeenCalledWith(orphanDir, {
      recursive: true,
      force: true,
    });
    mockFsRm.mockClear();
    mockFsMkdir.mockClear();

    const proc = createMockProcess();
    mockSpawn.mockReturnValueOnce(proc);
    const sessionPromise = hlsManager.ensureSession('orphan', '/orphan.mkv');
    sessionPromise.catch(() => {});
    await vi.advanceTimersByTimeAsync(0);

    // Nothing may touch the directory while the orphan delete runs.
    expect(mockFsRm).not.toHaveBeenCalled();
    expect(mockFsMkdir).not.toHaveBeenCalled();
    expect(mockSpawn).not.toHaveBeenCalled();

    finishRm();
    await vi.advanceTimersByTimeAsync(1000);
    await sessionPromise;
    await initPromise;

    expect(mockFsMkdir).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('waitForPlaylist handles playlist size 0', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    mockFsStat
      .mockResolvedValueOnce({ size: 0 })
      .mockResolvedValueOnce({ size: 100 });

    const promise = hlsManager.ensureSession('size-0-test', '/test.mp4');
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(mockFsStat).toHaveBeenCalledTimes(2);
  });

  it('waitForPlaylist rejects if FFmpeg exits normally but no playlist is found', async () => {
    const proc = createMockProcess();
    mockSpawn.mockReturnValue(proc);
    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    const promise = hlsManager.ensureSession('no-playlist-exit', '/test.mp4');
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10);
    proc.emit('close', 0, null);

    await expect(promise).rejects.toThrow(
      'HLS session finished but playlist not found',
    );
  });

  it('a process error after startup marks the session ERROR', async () => {
    const proc = await start('late-error');
    proc.emit('error', new Error('kill failed'));

    await expect(hlsManager.waitForSession('late-error')).resolves.toBe(
      HlsSessionStatus.ERROR,
    );
  });

  it('buffers partial stderr lines and keeps only the last error lines', async () => {
    const proc = await start('buffer-test');
    (hlsManager as any).sessions.get('buffer-test').progress.duration = 100;

    proc.stderr.emit('data', 'frame=1 fps=30 time=00:00:1');
    proc.stderr.emit('data', '0.00 speed=2x\r');
    expect(hlsManager.getSessionProgress('buffer-test')).toMatchObject({
      currentTime: 10,
      percent: 10,
      fps: 30,
      speed: '2x',
    });

    for (let i = 1; i <= 7; i++) {
      proc.stderr.emit('data', `error line ${i}\n`);
    }
    proc.stderr.emit('data', '   \n');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    proc.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(0);
    consoleSpy.mockRestore();

    const session = (hlsManager as any).sessions.get('buffer-test');
    expect(session.error.message).toBe(
      'FFmpeg exited with code 1: error line 3 | error line 4 | error line 5 | error line 6 | error line 7',
    );
  });

  it('ignores progress lines without a timestamp', async () => {
    const proc = await start('na-time');
    proc.stderr.emit('data', 'size=N/A time=N/A bitrate=N/A speed=N/A\n');
    expect(hlsManager.getSessionProgress('na-time')?.currentTime).toBe(0);
    expect((hlsManager as any).sessions.get('na-time').stderrTail).toEqual([]);
  });

  it('pinned sessions are exempt from the idle sweep until unpinned', async () => {
    hlsManager.pinSession('pin-test');
    const proc = await start('pin-test');

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    expect(proc.kill).not.toHaveBeenCalled();

    hlsManager.unpinSession('pin-test');
    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('ensureSessionUnthrottled waits for a pending session', async () => {
    mockSpawn.mockReturnValue(createMockProcess());
    const p1 = hlsManager.ensureSession('unthrottled-pending', '/v.mp4');
    const p2 = hlsManager.ensureSessionUnthrottled(
      'unthrottled-pending',
      '/v.mp4',
    );
    await vi.advanceTimersByTimeAsync(500);

    const [a, b] = await Promise.all([p1, p2]);
    expect(a).toBe(b);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('ensureSessionUnthrottled does NOT throw at the concurrency cap (BUG 6)', async () => {
    await start('i1');
    await start('i2');
    await expect(start('i3')).rejects.toBeInstanceOf(HlsBusyError);

    await expect(start('background', true)).resolves.toBeDefined();
  });

  it('retainSession resets the flag when the marker cannot be written', async () => {
    const proc = await start('retain-fail');
    proc.emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(0);
    mockFsWriteFile.mockRejectedValueOnce(new Error('ENOSPC'));

    await expect(
      hlsManager.retainSession('retain-fail', '/retain-fail.mkv'),
    ).rejects.toThrow('ENOSPC');
    expect((hlsManager as any).sessions.get('retain-fail').retained).toBe(
      false,
    );
    expect((hlsManager as any).retainedIds.has('retain-fail')).toBe(false);
    // A second call retains it
    await expect(
      hlsManager.retainSession('retain-fail', '/retain-fail.mkv'),
    ).resolves.toBe(true);
    await expect(
      hlsManager.retainSession('retain-fail', '/retain-fail.mkv'),
    ).resolves.toBe(true);
    const markerWrites = mockFsWriteFile.mock.calls.filter(([file]) =>
      String(file).endsWith('.retained'),
    );
    expect(markerWrites).toHaveLength(2);
    expect((hlsManager as any).retainedIds.has('retain-fail')).toBe(true);
  });

  it('resetInstance kills active processes', async () => {
    const proc = await start('reset-test');
    hlsManager.acquireSession('reset-test');
    hlsManager.releaseSession('reset-test');

    HlsManager.resetInstance();

    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('resetInstance without an instance is a no-op', () => {
    HlsManager.resetInstance();
    expect(() => HlsManager.resetInstance()).not.toThrow();
  });

  it('waitForSession returns STOPPED if session does not exist', async () => {
    const status = await hlsManager.waitForSession('non-existent');
    expect(status).toBe('stopped');
  });

  it('emits status events for observers', async () => {
    const statuses: string[] = [];
    hlsManager.on('status:observed', (s: string) => statuses.push(s));
    const proc = await start('observed');
    proc.emit('close', 0, null);
    await vi.advanceTimersByTimeAsync(0);

    expect(statuses).toEqual(['active', 'complete']);
  });

  it('stopAll waits for processes that are still exiting', async () => {
    const proc = createMockProcess();
    proc.kill = vi.fn((signal: string) => {
      proc.killed = true;
      if (signal === 'SIGKILL') {
        queueMicrotask(() => proc.emit('close', null, signal));
      }
      return true;
    });
    mockSpawn.mockReturnValueOnce(proc);
    const promise = hlsManager.ensureSession('lingering', '/l.mkv');
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    void hlsManager.stopSession('lingering');

    let done = false;
    const stopping = hlsManager.stopAll().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    await stopping;
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('gives up waiting for an ffmpeg that ignores even SIGKILL', async () => {
    const proc = createMockProcess();
    proc.kill = vi.fn(() => {
      proc.killed = true;
      return true;
    });
    mockSpawn.mockReturnValueOnce(proc);
    const promise = hlsManager.ensureSession('unkillable', '/u.mkv');
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    mockFsRm.mockClear();

    const stopping = hlsManager.stopSession('unkillable');
    await vi.advanceTimersByTimeAsync(5001);
    await stopping;

    expect(mockFsRm).toHaveBeenCalledWith(
      path.join(CACHE_DIR, 'unkillable'),
      expect.anything(),
    );
  });

  it('a kill that throws is ignored', async () => {
    const proc = createMockProcess();
    proc.kill = vi.fn(() => {
      throw new Error('ESRCH');
    });
    mockSpawn.mockReturnValueOnce(proc);
    const promise = hlsManager.ensureSession('gone', '/g.mkv');
    await vi.advanceTimersByTimeAsync(0);
    await promise;

    const stopping = hlsManager.stopSession('gone');
    await vi.advanceTimersByTimeAsync(5001);
    await expect(stopping).resolves.toBeUndefined();
  });

  it('a non-Error startup failure is wrapped', async () => {
    const { createMediaSource } =
      await import('../../src/core/media/media-source.ts');
    vi.mocked(createMediaSource).mockImplementationOnce(
      () =>
        ({
          getFFmpegInput: vi.fn().mockRejectedValue('boom'),
        }) as any,
    );
    await expect(hlsManager.ensureSession('odd', '/o.mkv')).rejects.toThrow(
      'boom',
    );
  });

  it('fails when ffmpeg is not available', async () => {
    vi.resetModules();
    vi.doMock('ffmpeg-static', () => ({ default: null }));
    const mod = await import('../../src/core/media/hls-manager.ts');
    const manager = mod.HlsManager.getInstance();
    manager.setCacheDir(CACHE_DIR);

    await expect(manager.ensureSession('nof', '/n.mkv')).rejects.toThrow(
      'FFmpeg not found',
    );
    mod.HlsManager.resetInstance();
    vi.doUnmock('ffmpeg-static');
  });
});
