// @vitest-environment node
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vite-plus/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Allow the fixtures and keep the database out of it.
vi.mock('../../src/core/auth/security.ts', async () => {
  const actual = await vi.importActual<object>(
    '../../src/core/auth/security.ts',
  );
  return {
    ...actual,
    authorizeFilePath: vi.fn(async (p: string) => ({
      isAllowed: true,
      realPath: p,
    })),
  };
});

const db = vi.hoisted(() => ({
  getMediaDirectories: vi.fn(async () => []),
  isFileInLibrary: vi.fn(async () => true),
  addTranscodeJob: vi.fn(async () => undefined),
  updateTranscodeJobStatus: vi.fn(async () => undefined),
  getPendingTranscodeJobs: vi.fn(async () => [] as string[]),
  deleteTranscodeJob: vi.fn(async () => undefined),
}));
vi.mock('../../src/core/database/database.ts', () => db);

import {
  HlsManager,
  HlsSessionStatus,
} from '../../src/core/media/hls-manager.ts';
import { TranscodeQueueManager } from '../../src/core/media/transcode-queue-manager.ts';
import { generateSessionId } from '../../src/core/media/hls-handler.ts';

/**
 * Real ffmpeg, real HlsManager and real TranscodeQueueManager on short
 * h264/aac fixtures, which are stream-copied and finish in about 100 ms.
 */
describe('HLS session lifecycle with real ffmpeg', () => {
  const fixture = path.join(
    process.cwd(),
    'tests/fixtures/diversity/test_libx264_aac.mp4',
  );
  let cacheDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-lifecycle-'));
    HlsManager.resetInstance();
    TranscodeQueueManager.resetInstance();
    await HlsManager.getInstance().init(cacheDir);
  });

  afterEach(async () => {
    await HlsManager.getInstance().stopAll();
    HlsManager.resetInstance();
    TranscodeQueueManager.resetInstance();
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const readPlaylist = (id: string) =>
    fs.readFile(path.join(cacheDir, id, 'playlist.m3u8'), 'utf8');

  it('a pre-transcode that finishes before the first playlist poll completes (F10)', async () => {
    await TranscodeQueueManager.getInstance().enqueue(fixture);

    await vi.waitFor(
      () =>
        expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
          fixture,
          'done',
          null,
        ),
      { timeout: 15000, interval: 50 },
    );
  }, 20000);

  it('a finished session is COMPLETE, has ENDLIST and is reused as-is (F03, F56)', async () => {
    const hls = HlsManager.getInstance();
    const id = await generateSessionId(fixture);

    await hls.ensureSession(id, fixture);
    await expect(hls.waitForSession(id)).resolves.toBe(
      HlsSessionStatus.COMPLETE,
    );
    const playlist = await readPlaylist(id);
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(playlist).toContain('#EXT-X-ENDLIST');
    const segment = path.join(cacheDir, id, 'seg-000.ts');
    const before = await fs.stat(segment);

    // The next playlist reload must not wipe the output and start over.
    await hls.ensureSession(id, fixture);

    const after = await fs.stat(segment);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await readPlaylist(id)).toBe(playlist);
    expect(hls.getSessionProgress(id)?.percent).toBe(100);
  }, 20000);

  it('reports the duration while transcoding (F31)', async () => {
    const hls = HlsManager.getInstance();
    const id = await generateSessionId(fixture);

    await hls.ensureSession(id, fixture);

    expect(hls.getSessionProgress(id)?.duration).toBeGreaterThan(0);
  }, 20000);

  it('keeps a finished pre-transcode across a restart and reuses it (F25)', async () => {
    const id = await generateSessionId(fixture);
    await TranscodeQueueManager.getInstance().enqueue(fixture);
    await vi.waitFor(
      () =>
        expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
          fixture,
          'done',
          null,
        ),
      { timeout: 15000, interval: 50 },
    );
    const playlist = await readPlaylist(id);

    // Restart, wired like both modes: setCacheDir, then start() the queue,
    // which runs the startup cleanup of the cache directory.
    HlsManager.resetInstance();
    TranscodeQueueManager.resetInstance();
    const hls = HlsManager.getInstance();
    hls.setCacheDir(cacheDir);
    await TranscodeQueueManager.getInstance().start();

    expect(await readPlaylist(id)).toBe(playlist);
    await hls.ensureSession(id, fixture);
    expect(hls.getSessionProgress(id)).toMatchObject({ percent: 100 });
    expect(hls.getSessionProgress(id)?.duration).toBeGreaterThan(0);
    expect(await readPlaylist(id)).toBe(playlist);
  }, 30000);

  it('transcodes again when a pre-transcoded file was replaced (F25)', async () => {
    // A copy, so its modification time can change
    const source = path.join(cacheDir, 'replaced.mp4');
    await fs.copyFile(fixture, source);
    const id = await generateSessionId(source);
    const marker = path.join(cacheDir, id, '.retained');
    await TranscodeQueueManager.getInstance().enqueue(source);
    await vi.waitFor(
      () =>
        expect(db.updateTranscodeJobStatus).toHaveBeenCalledWith(
          source,
          'done',
          null,
        ),
      { timeout: 15000, interval: 50 },
    );
    await fs.access(marker);

    // Restart, then the file is replaced by one of the same size.
    HlsManager.resetInstance();
    const hls = HlsManager.getInstance();
    await hls.init(cacheDir);
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(source, later, later);

    await hls.ensureSession(id, source);

    // The stale output (and its marker) was replaced by a new transcode.
    await expect(fs.access(marker)).rejects.toThrow();
    await expect(hls.waitForSession(id)).resolves.toBe(
      HlsSessionStatus.COMPLETE,
    );
  }, 30000);

  it('startup cleanup removes output that is not a retained pre-transcode (F26)', async () => {
    const hls = HlsManager.getInstance();
    const id = await generateSessionId(fixture);
    await hls.ensureSession(id, fixture);
    await hls.waitForSession(id);

    // Simulate a crash: the session never got cleaned up.
    HlsManager.resetInstance();
    await HlsManager.getInstance().init(cacheDir);

    await expect(fs.access(path.join(cacheDir, id))).rejects.toThrow();
  }, 20000);
});
