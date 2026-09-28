// @vitest-environment node
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

/**
 * TranscodeQueueManager driven through the real HlsManager; only ffmpeg,
 * the file system and the database are faked.
 */
const { mockSpawn, mockGetFFmpegStreams, fsMock, db } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockGetFFmpegStreams: vi.fn(),
  fsMock: {
    mkdir: vi.fn(),
    rm: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
  db: {
    addTranscodeJob: vi.fn(),
    updateTranscodeJobStatus: vi.fn(),
    getPendingTranscodeJobs: vi.fn(),
    deleteTranscodeJob: vi.fn(),
  },
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));
vi.mock('fs/promises', () => ({ default: fsMock, ...fsMock }));
vi.mock('../../src/core/database/database.ts', () => db);
vi.mock('../../src/core/media/media-source.ts', () => ({
  createMediaSource: (filePath: string) => ({
    getFFmpegInput: async () => filePath,
    getSize: async () => 777,
  }),
}));
vi.mock('../../src/infrastructure/ffmpeg-utils.ts', () => ({
  getHlsTranscodeArgs: () => ['-f', 'hls', 'playlist.m3u8'],
  getFFmpegStreams: mockGetFFmpegStreams,
  canStreamCopy: () => ({ copyVideo: false, copyAudio: false }),
}));
vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));

import { HlsManager } from '../../src/core/media/hls-manager.ts';
import { TranscodeQueueManager } from '../../src/core/media/transcode-queue-manager.ts';
import { generateSessionId } from '../../src/core/media/hls-handler.ts';

type MockProc = EventEmitter & {
  kill: ReturnType<typeof vi.fn>;
  stderr: EventEmitter;
  killed: boolean;
};

function createMockProcess(): MockProc {
  const proc = new EventEmitter() as MockProc;
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn((signal: string) => {
    proc.killed = true;
    queueMicrotask(() => proc.emit('close', null, signal));
    return true;
  });
  return proc;
}

describe('TranscodeQueueManager with the real HlsManager', () => {
  const CACHE_DIR = '/tmp/hls-queue';
  const procs: MockProc[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    procs.length = 0;
    mockSpawn.mockImplementation(() => {
      const proc = createMockProcess();
      procs.push(proc);
      return proc;
    });
    fsMock.mkdir.mockResolvedValue(undefined);
    fsMock.rm.mockResolvedValue(undefined);
    fsMock.readdir.mockResolvedValue([]);
    fsMock.stat.mockResolvedValue({
      size: 100,
      mtimeMs: 42,
      isDirectory: () => true,
    });
    mockGetFFmpegStreams.mockResolvedValue({ hasVideo: true, hasAudio: true });
    fsMock.access.mockRejectedValue(new Error('ENOENT'));
    fsMock.readFile.mockRejectedValue(new Error('ENOENT'));
    fsMock.writeFile.mockResolvedValue(undefined);
    db.addTranscodeJob.mockResolvedValue(undefined);
    db.updateTranscodeJobStatus.mockResolvedValue(undefined);
    db.getPendingTranscodeJobs.mockResolvedValue([]);
    db.deleteTranscodeJob.mockResolvedValue(undefined);

    HlsManager.resetInstance();
    TranscodeQueueManager.resetInstance();
    HlsManager.getInstance().setCacheDir(CACHE_DIR);
  });

  afterEach(() => {
    HlsManager.resetInstance();
    TranscodeQueueManager.resetInstance();
  });

  it('cancelling running jobs frees their queue slots (F23)', async () => {
    const queue = TranscodeQueueManager.getInstance();
    await queue.enqueue('/a.mkv');
    await queue.enqueue('/b.mkv');
    await queue.enqueue('/c.mkv');
    await vi.waitFor(() => expect(procs).toHaveLength(2));

    // "Clear HLS" on both running jobs
    await queue.cancel('/a.mkv');
    await queue.cancel('/b.mkv');

    // The third job gets a slot and runs to completion
    await vi.waitFor(() => expect(procs).toHaveLength(3));
    procs[2]!.emit('close', 0, null);
    await vi.waitFor(() =>
      expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
        '/c.mkv',
        'done',
        null,
      ),
    );
    // Cancelled jobs are not marked failed (their rows are deleted instead)
    expect(db.updateTranscodeJobStatus).not.toHaveBeenCalledWith(
      '/a.mkv',
      'failed',
      expect.anything(),
    );
  });

  it('a cancelled job can be queued again right away (F24)', async () => {
    const queue = TranscodeQueueManager.getInstance();
    await queue.enqueue('/again.mkv');
    await vi.waitFor(() => expect(procs).toHaveLength(1));
    await queue.cancel('/again.mkv');

    await queue.enqueue('/again.mkv');

    await vi.waitFor(() => expect(procs).toHaveLength(2));
    procs[1]!.emit('close', 0, null);
    await vi.waitFor(() =>
      expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
        '/again.mkv',
        'done',
        null,
      ),
    );
  });

  it('a job cancelled during its probe and queued again right away still runs (F24)', async () => {
    let resolveProbe!: (info: unknown) => void;
    mockGetFFmpegStreams.mockImplementationOnce(
      () => new Promise((resolve) => (resolveProbe = resolve)),
    );
    const queue = TranscodeQueueManager.getInstance();
    await queue.enqueue('/probe.mkv');
    await vi.waitFor(() => expect(mockGetFFmpegStreams).toHaveBeenCalled());

    await queue.cancel('/probe.mkv'); // "Clear HLS"
    await queue.enqueue('/probe.mkv'); // "Pre-transcode" again
    resolveProbe({ hasVideo: true, hasAudio: true });

    await vi.waitFor(() => expect(procs).toHaveLength(1));
    procs[0]!.emit('close', 0, null);
    await vi.waitFor(() =>
      expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
        '/probe.mkv',
        'done',
        null,
      ),
    );
    expect(db.updateTranscodeJobStatus).not.toHaveBeenCalledWith(
      '/probe.mkv',
      'failed',
      expect.anything(),
    );
  });

  it('marks a job failed when ffmpeg is killed by someone else (F114)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const queue = TranscodeQueueManager.getInstance();
    await queue.enqueue('/oom.mkv');
    await vi.waitFor(() => expect(procs).toHaveLength(1));

    procs[0]!.emit('close', null, 'SIGKILL'); // e.g. the OOM killer

    await vi.waitFor(() =>
      expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
        '/oom.mkv',
        'failed',
        'Transcoding failed',
      ),
    );
    error.mockRestore();
  });

  it('keeps the finished output of a job on disk (F25)', async () => {
    const queue = TranscodeQueueManager.getInstance();
    const id = await generateSessionId('/movie.mkv');
    await queue.enqueue('/movie.mkv');
    await vi.waitFor(() => expect(procs).toHaveLength(1));

    procs[0]!.emit('close', 0, null);

    await vi.waitFor(() =>
      expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
        '/movie.mkv',
        'done',
        null,
      ),
    );
    // The marker records which file the output belongs to
    expect(fsMock.writeFile).toHaveBeenCalledWith(
      path.join(CACHE_DIR, id, '.retained'),
      JSON.stringify({ size: 777, mtimeMs: 42 }),
    );
  });
});
