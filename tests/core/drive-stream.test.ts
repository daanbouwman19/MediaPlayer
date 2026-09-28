// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';
import {
  getDriveStreamWithCache,
  DRIVE_STREAM_STALL_TIMEOUT_MS,
} from '../../src/core/media/drive-stream';
import {
  registerDriveBackend,
  resetDriveBackend,
  type DriveBackend,
} from '../../src/core/media/drive-backend';

/**
 * These tests run getDriveStreamWithCache against a real cache file on disk
 * and a fake Drive backend that serves byte ranges of an in-memory "remote"
 * file, so the bytes that come out can be compared exactly.
 */

const FILE_ID = 'file-123';
// Larger than any default stream highWaterMark, so backpressure can build.
const TOTAL = 256 * 1024;
const REMOTE = Buffer.alloc(TOTAL);
for (let i = 0; i < TOTAL; i++) REMOTE[i] = (i * 7 + 3) % 256;

let dir: string;
let cachePath: string;
let backend: {
  getFileMetadata: ReturnType<typeof vi.fn>;
  getFileStream: ReturnType<typeof vi.fn>;
  listFolder: ReturnType<typeof vi.fn>;
  setCredentials: ReturnType<typeof vi.fn>;
  getCachedFile: ReturnType<typeof vi.fn>;
};

/** A Drive download of REMOTE[start..end] that ends normally. */
function driveRange(range?: { start?: number; end?: number }): Readable {
  const start = range?.start ?? 0;
  const end = range?.end ?? TOTAL - 1;
  return Readable.from([REMOTE.subarray(start, end + 1)]);
}

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Writes the first `bytes` bytes of REMOTE as the (partial) cache file. */
async function writeCache(bytes: number) {
  await fs.writeFile(cachePath, REMOTE.subarray(0, bytes));
}

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'drive-stream-'));
  cachePath = path.join(dir, FILE_ID);
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await fs.rm(cachePath, { force: true });
  backend = {
    getFileMetadata: vi.fn().mockResolvedValue({
      id: FILE_ID,
      size: String(TOTAL),
      mimeType: 'video/mp4',
    }),
    getFileStream: vi.fn(async (_id: string, range?: any) => driveRange(range)),
    listFolder: vi.fn(),
    setCredentials: vi.fn(),
    // The cache manager decrypts in readRange; this double keeps the cache
    // file in plaintext.
    getCachedFile: vi.fn().mockResolvedValue({
      path: cachePath,
      totalSize: TOTAL,
      readRange: (start: number, end: number) =>
        createReadStream(cachePath, { start, end }),
    }),
  };
  resetDriveBackend();
  registerDriveBackend(backend as unknown as DriveBackend);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('getDriveStreamWithCache', () => {
  it('serves a fully cached file from disk without touching Drive', async () => {
    await writeCache(TOTAL);

    const { stream, length } = await getDriveStreamWithCache(FILE_ID);

    expect(length).toBe(TOTAL);
    expect((await collect(stream)).equals(REMOTE)).toBe(true);
    expect(backend.getFileStream).not.toHaveBeenCalled();
  });

  it('serves a range that lies inside the downloaded prefix from disk', async () => {
    await writeCache(10_000);

    const { stream, length } = await getDriveStreamWithCache(FILE_ID, {
      start: 100,
      end: 4_999,
    });

    expect(length).toBe(4_900);
    expect((await collect(stream)).equals(REMOTE.subarray(100, 5_000))).toBe(
      true,
    );
    expect(backend.getFileStream).not.toHaveBeenCalled();
  });

  it('completes a range that runs past the downloaded prefix from Drive', async () => {
    // Regression (F07): this used to be clamped to the 10,000 cached bytes,
    // so ffmpeg saw a premature end of input.
    await writeCache(10_000);

    const { stream, length } = await getDriveStreamWithCache(FILE_ID, {
      start: 5_000,
      end: TOTAL - 1,
    });

    expect(length).toBe(TOTAL - 5_000);
    const body = await collect(stream);
    expect(body.length).toBe(TOTAL - 5_000);
    expect(body.equals(REMOTE.subarray(5_000))).toBe(true);
    // Only the part that is not on disk is fetched from Drive.
    expect(backend.getFileStream).toHaveBeenCalledTimes(1);
    expect(backend.getFileStream).toHaveBeenCalledWith(FILE_ID, {
      start: 10_000,
      end: TOTAL - 1,
    });
  });

  it('returns the whole file for a request without a range while downloading', async () => {
    // Regression (F07): a 200 or a data URL used to get only the prefix.
    await writeCache(1_000);

    const { stream, length } = await getDriveStreamWithCache(FILE_ID);

    expect(length).toBe(TOTAL);
    expect((await collect(stream)).equals(REMOTE)).toBe(true);
  });

  it('fetches from Drive when the range starts after the downloaded prefix', async () => {
    await writeCache(1_000);

    const { stream, length } = await getDriveStreamWithCache(FILE_ID, {
      start: 2_000,
      end: 2_999,
    });

    expect(length).toBe(1_000);
    expect((await collect(stream)).equals(REMOTE.subarray(2_000, 3_000))).toBe(
      true,
    );
    expect(backend.getFileStream).toHaveBeenCalledWith(FILE_ID, {
      start: 2_000,
      end: 2_999,
    });
  });

  it('honors a single-byte range (bytes=0-0)', async () => {
    await writeCache(TOTAL);

    const { stream, length } = await getDriveStreamWithCache(FILE_ID, {
      start: 0,
      end: 0,
    });

    expect(length).toBe(1);
    expect((await collect(stream)).equals(REMOTE.subarray(0, 1))).toBe(true);
  });

  it('streams from Drive when the cache is unavailable', async () => {
    backend.getCachedFile.mockRejectedValue(new Error('Cache missing'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { stream, length } = await getDriveStreamWithCache(FILE_ID);

    expect(length).toBe(TOTAL);
    expect((await collect(stream)).equals(REMOTE)).toBe(true);
    expect(backend.getFileStream).toHaveBeenCalledWith(FILE_ID, {
      start: 0,
      end: TOTAL - 1,
    });
  });

  it('ignores a cache file that was sized for another revision', async () => {
    await writeCache(TOTAL);
    backend.getCachedFile.mockResolvedValue({
      path: cachePath,
      totalSize: TOTAL + 10,
    });

    const { stream } = await getDriveStreamWithCache(FILE_ID);

    expect((await collect(stream)).equals(REMOTE)).toBe(true);
    expect(backend.getFileStream).toHaveBeenCalledWith(FILE_ID, {
      start: 0,
      end: TOTAL - 1,
    });
  });

  it('continues from Drive when the cache file shrinks before it is read', async () => {
    await writeCache(TOTAL);
    const { stream, length } = await getDriveStreamWithCache(FILE_ID);
    // Evicted/truncated after the size check but before reading.
    await fs.truncate(cachePath, 3_000);

    expect(length).toBe(TOTAL);
    expect((await collect(stream)).equals(REMOTE)).toBe(true);
    expect(backend.getFileStream).toHaveBeenCalledWith(FILE_ID, {
      start: 3_000,
      end: TOTAL - 1,
    });
  });

  it('continues from Drive when the cache file disappears before it is read', async () => {
    await writeCache(TOTAL);
    const { stream } = await getDriveStreamWithCache(FILE_ID);
    await fs.rm(cachePath);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect((await collect(stream)).equals(REMOTE)).toBe(true);
    expect(backend.getFileStream).toHaveBeenCalledWith(FILE_ID, {
      start: 0,
      end: TOTAL - 1,
    });
  });

  it('fails instead of ending short when Drive delivers too few bytes', async () => {
    backend.getFileStream.mockResolvedValue(
      Readable.from([REMOTE.subarray(0, 100)]),
    );

    const { stream, length } = await getDriveStreamWithCache(FILE_ID);

    expect(length).toBe(TOTAL);
    await expect(collect(stream)).rejects.toThrow(/ended at byte 100/);
  });

  it('drops bytes beyond the requested range', async () => {
    // A server that ignores Range must not break the promised length.
    backend.getFileStream.mockResolvedValue(Readable.from([REMOTE]));

    const { stream } = await getDriveStreamWithCache(FILE_ID, {
      start: 0,
      end: 99,
    });

    expect((await collect(stream)).equals(REMOTE.subarray(0, 100))).toBe(true);
  });

  it('propagates a Drive stream error', async () => {
    const drive = new PassThrough();
    backend.getFileStream.mockResolvedValue(drive);
    const { stream } = await getDriveStreamWithCache(FILE_ID);

    const result = collect(stream);
    drive.write(REMOTE.subarray(0, 10));
    drive.destroy(new Error('ECONNRESET'));

    await expect(result).rejects.toThrow('ECONNRESET');
  });

  it('propagates a failure to open the Drive download', async () => {
    backend.getFileStream.mockRejectedValue(new Error('403 Forbidden'));
    const { stream } = await getDriveStreamWithCache(FILE_ID);

    await expect(collect(stream)).rejects.toThrow('403 Forbidden');
  });

  it('destroys the Drive download when the consumer goes away', async () => {
    const drive = new PassThrough();
    backend.getFileStream.mockResolvedValue(drive);
    const { stream } = await getDriveStreamWithCache(FILE_ID);

    stream.resume();
    await vi.waitFor(() => expect(backend.getFileStream).toHaveBeenCalled());
    drive.write(REMOTE.subarray(0, 10));
    stream.destroy();

    await vi.waitFor(() => expect(drive.destroyed).toBe(true));
  });

  it('destroys a Drive download that opens after the consumer went away', async () => {
    const drive = new PassThrough();
    let resolveOpen!: (s: Readable) => void;
    backend.getFileStream.mockReturnValue(
      new Promise<Readable>((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const { stream } = await getDriveStreamWithCache(FILE_ID);

    stream.resume();
    await vi.waitFor(() => expect(backend.getFileStream).toHaveBeenCalled());
    stream.destroy();
    resolveOpen(drive);

    await vi.waitFor(() => expect(drive.destroyed).toBe(true));
  });

  it('fails a Drive download that stops delivering data', async () => {
    vi.useFakeTimers();
    const drive = new PassThrough();
    backend.getFileStream.mockResolvedValue(drive);
    const { stream } = await getDriveStreamWithCache(FILE_ID);

    const errors: Error[] = [];
    stream.on('error', (err) => errors.push(err));
    stream.resume();
    await vi.waitFor(() => expect(backend.getFileStream).toHaveBeenCalled());
    drive.write(REMOTE.subarray(0, 10));

    await vi.advanceTimersByTimeAsync(DRIVE_STREAM_STALL_TIMEOUT_MS + 1);

    expect(errors[0]?.message).toMatch(/stalled/);
    expect(drive.destroyed).toBe(true);
  });

  it('does not treat a consumer that stopped reading as a stall', async () => {
    vi.useFakeTimers();
    const drive = new PassThrough();
    backend.getFileStream.mockResolvedValue(drive);
    const { stream } = await getDriveStreamWithCache(FILE_ID);

    const errors: Error[] = [];
    stream.on('error', (err) => errors.push(err));
    // Start reading, then apply backpressure by not reading any further.
    stream.once('readable', () => {});
    await vi.waitFor(() => expect(backend.getFileStream).toHaveBeenCalled());
    // Fill the stream's buffer exactly. Its size is Node's default
    // highWaterMark, which differs between Node releases (16 KiB or 64 KiB),
    // and a partly filled buffer still asks Drive for more data.
    const buffered = stream.readableHighWaterMark;
    expect(buffered).toBeLessThan(TOTAL);
    drive.write(REMOTE.subarray(0, buffered));
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.readableLength).toBe(buffered);

    await vi.advanceTimersByTimeAsync(DRIVE_STREAM_STALL_TIMEOUT_MS * 3);
    expect(errors).toEqual([]);

    // Once the consumer reads again the rest arrives normally.
    vi.useRealTimers();
    drive.end(REMOTE.subarray(buffered));
    expect((await collect(stream)).equals(REMOTE)).toBe(true);
  });

  it('returns an empty stream for an empty file', async () => {
    backend.getFileMetadata.mockResolvedValue({ id: FILE_ID, size: '0' });
    backend.getCachedFile.mockResolvedValue({ path: cachePath, totalSize: 0 });

    const { stream, length } = await getDriveStreamWithCache(FILE_ID);

    expect(length).toBe(0);
    expect((await collect(stream)).length).toBe(0);
    expect(backend.getFileStream).not.toHaveBeenCalled();
  });

  it('serves a cached file offline using the size the cache knows', async () => {
    await writeCache(TOTAL);
    backend.getFileMetadata.mockRejectedValue(new Error('ENOTFOUND'));

    const { stream, length } = await getDriveStreamWithCache(FILE_ID);

    expect(length).toBe(TOTAL);
    expect((await collect(stream)).equals(REMOTE)).toBe(true);
  });

  it('rethrows the metadata error when nothing is cached', async () => {
    backend.getFileMetadata.mockRejectedValue(new Error('ENOTFOUND'));
    backend.getCachedFile.mockRejectedValue(new Error('no cache'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(getDriveStreamWithCache(FILE_ID)).rejects.toThrow('ENOTFOUND');
  });

  it('rejects an inverted range', async () => {
    await expect(
      getDriveStreamWithCache(FILE_ID, { start: 500, end: 100 }),
    ).rejects.toThrow(RangeError);
  });
});
