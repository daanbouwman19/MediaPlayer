// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import {
  getDriveBackend,
  getDriveFileMetadataCached,
  invalidateDriveFileMetadata,
  parseDriveFileSize,
  registerDriveBackend,
  resetDriveBackend,
  type DriveBackend,
} from '../../src/core/media/drive-backend';

function makeBackend() {
  return {
    getFileMetadata: vi.fn(async (id: string) => ({
      id,
      size: '10',
      mimeType: 'video/mp4',
    })),
    getFileStream: vi.fn(),
    listFolder: vi.fn(),
    setCredentials: vi.fn(),
    getCachedFile: vi.fn(),
  };
}

describe('drive-backend', () => {
  let backend: ReturnType<typeof makeBackend>;

  beforeEach(() => {
    resetDriveBackend();
    backend = makeBackend();
    registerDriveBackend(backend as unknown as DriveBackend);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws a clear error when no backend was registered', () => {
    resetDriveBackend();
    expect(() => getDriveBackend()).toThrow('has not been registered');
  });

  it('returns the registered backend', () => {
    expect(getDriveBackend()).toBe(backend);
  });

  describe('getDriveFileMetadataCached', () => {
    it('shares one lookup between concurrent and later callers', async () => {
      const [a, b] = await Promise.all([
        getDriveFileMetadataCached('f1'),
        getDriveFileMetadataCached('f1'),
      ]);
      const c = await getDriveFileMetadataCached('f1');

      expect(a).toBe(b);
      expect(c).toBe(a);
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(1);
    });

    it('caches per file', async () => {
      await getDriveFileMetadataCached('f1');
      await getDriveFileMetadataCached('f2');
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(2);
    });

    it('refetches once the TTL has passed', async () => {
      vi.useFakeTimers();
      await getDriveFileMetadataCached('f1');
      vi.advanceTimersByTime(4 * 60 * 1000);
      await getDriveFileMetadataCached('f1');
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2 * 60 * 1000);
      await getDriveFileMetadataCached('f1');
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(2);
    });

    it('does not cache failures', async () => {
      backend.getFileMetadata.mockRejectedValueOnce(new Error('quota'));

      await expect(getDriveFileMetadataCached('f1')).rejects.toThrow('quota');
      await expect(getDriveFileMetadataCached('f1')).resolves.toMatchObject({
        id: 'f1',
      });
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(2);
    });

    it('refetches after invalidation', async () => {
      await getDriveFileMetadataCached('f1');
      invalidateDriveFileMetadata('f1');
      await getDriveFileMetadataCached('f1');
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(2);
    });

    it('evicts the least recently used entry beyond its capacity', async () => {
      for (let i = 0; i <= 500; i++) {
        await getDriveFileMetadataCached(`f${i}`);
      }
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(501);

      // f0 was the oldest entry and has been evicted; f500 is still cached.
      await getDriveFileMetadataCached('f500');
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(501);
      await getDriveFileMetadataCached('f0');
      expect(backend.getFileMetadata).toHaveBeenCalledTimes(502);
    });
  });

  describe('parseDriveFileSize', () => {
    it('parses the decimal string Drive returns', () => {
      expect(parseDriveFileSize({ size: '1048576' })).toBe(1048576);
      expect(parseDriveFileSize({ size: '0' })).toBe(0);
    });

    it.each([
      ['missing', {}],
      ['null', { size: null }],
      ['not a number', { size: 'abc' }],
      ['negative', { size: '-1' }],
    ])('rejects a %s size', (_label, meta) => {
      expect(() => parseDriveFileSize(meta)).toThrow('no downloadable size');
    });
  });
});
