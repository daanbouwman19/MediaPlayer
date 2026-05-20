import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import fs from 'fs';
import { EventEmitter } from 'events';
import {
  cleanupDriveCacheManager,
  getDriveCacheManager,
  initializeDriveCacheManager,
} from '../../src/main/drive-cache-manager';

// Mocks
vi.mock('fs', () => {
  const mocks = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    statSync: vi.fn(),
    rmSync: vi.fn(),
    createWriteStream: vi.fn(),
    promises: {
      stat: vi.fn(),
      unlink: vi.fn(),
      readdir: vi.fn(),
      rm: vi.fn(),
    },
  };
  return {
    default: mocks,
    ...mocks,
  };
});

vi.mock('../../src/main/google-drive-service', () => ({
  getDriveFileMetadata: vi.fn(),
  getDriveFileStream: vi.fn(),
}));

function setupMockWriteStream(
  writeStream: EventEmitter,
  events: { ready?: boolean; finish?: boolean } = {},
) {
  const finalEvents = { ready: true, ...events };

  vi.mocked(fs.createWriteStream).mockImplementation(() => {
    setTimeout(() => {
      if (finalEvents.ready) writeStream.emit('ready');
      if (finalEvents.finish) {
        // Emit finish in a subsequent macrotask to allow the 'ready' promise to resolve first.
        setTimeout(() => writeStream.emit('finish'), 0);
      }
    }, 0);
    return writeStream as any;
  });
}

describe('DriveCacheManager', () => {
  let driveCacheManager: ReturnType<typeof initializeDriveCacheManager>;
  const statMock = () => fs.promises.stat as unknown as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    cleanupDriveCacheManager();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    statMock().mockReset();
    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );
    vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);
    vi.mocked(fs.promises.readdir).mockResolvedValue([]);
    driveCacheManager = initializeDriveCacheManager('drive-cache-test');
  });

  it('initializes cache directory', async () => {
    expect(fs.mkdirSync).toHaveBeenCalledWith('drive-cache-test', {
      recursive: true,
    });
  });

  it('getCachedFilePath returns existing cache', async () => {
    const fileId = 'existing-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '1000',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockResolvedValue({ size: 1000 } as any);

    const result = await driveCacheManager.getCachedFilePath(fileId);

    expect(result.path).toContain(fileId);
    expect(result.totalSize).toBe(1000);
    expect(result.mimeType).toBe('video/mp4');
  });

  it('getCachedFilePath handles metadata fetch error', async () => {
    const fileId = 'meta-error-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockRejectedValue(
      new Error('Meta Fail'),
    );

    statMock().mockResolvedValue({ size: 1000 } as any);

    const result = await driveCacheManager.getCachedFilePath(fileId);

    // Should fallback to defaults
    expect(result.totalSize).toBe(0);
    expect(result.mimeType).toBe('video/mp4');
  });

  it('reuses cached metadata on subsequent calls', async () => {
    const fileId = 'cached-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '1500',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockResolvedValue({ size: 1500 } as any);

    await driveCacheManager.getCachedFilePath(fileId);
    expect(driveService.getDriveFileMetadata).toHaveBeenCalledTimes(1);

    await driveCacheManager.getCachedFilePath(fileId);
    expect(driveService.getDriveFileMetadata).toHaveBeenCalledTimes(1);
  });

  it('getCachedFilePath resumes partial download', async () => {
    const fileId = 'partial-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '2000',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockResolvedValue({ size: 500 } as any);

    const writeStream = new EventEmitter();
    (writeStream as any).path = '/tmp/cache/partial';
    // Use helper instead of setTimeout
    setupMockWriteStream(writeStream);

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    await driveCacheManager.getCachedFilePath(fileId);

    // Expect startDownload called with offset 500
    expect(driveService.getDriveFileStream).toHaveBeenCalledWith(
      fileId,
      expect.objectContaining({ start: 500 }),
    );
  });

  it('getCachedFilePath downloads file on cache miss', async () => {
    const fileId = 'missing-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '200',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const writeStream = new EventEmitter();
    (writeStream as any).path = '/tmp/cache/file';

    // Schedule ready and finish
    setupMockWriteStream(writeStream, { ready: true, finish: true });

    const promise = driveCacheManager.getCachedFilePath(fileId);
    const result = await promise;

    expect(result.totalSize).toBe(200);
    expect(fs.createWriteStream).toHaveBeenCalled();
    expect(driveService.getDriveFileStream).toHaveBeenCalledWith(
      fileId,
      expect.anything(),
    );
  });

  it('getCachedFilePath handles download error (start fail)', async () => {
    const fileId = 'error-file';
    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );

    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileStream).mockRejectedValue(
      new Error('Download Fail'),
    );
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    await expect(driveCacheManager.getCachedFilePath(fileId)).rejects.toThrow(
      'Download Fail',
    );
  });

  it('handles stream error properly', async () => {
    const fileId = 'stream-error-file';
    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    const mockSourceStream = new EventEmitter();
    (mockSourceStream as any).pipe = vi.fn();
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockSourceStream as any,
    );

    const writeStream = new EventEmitter();
    (writeStream as any).close = vi.fn();

    // Use helper instead of setTimeout
    setupMockWriteStream(writeStream);

    const res = await driveCacheManager.getCachedFilePath(fileId);
    expect(res.path).toBeDefined();

    // Emit error on source stream AFTER resolution
    mockSourceStream.emit('error', new Error('Stream Dies'));

    expect((writeStream as any).close).toHaveBeenCalled();
  });

  it('active download handles concurrent requests', async () => {
    const fileId = 'concurrent-file';
    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const writeStream = new EventEmitter();
    // Use helper instead of setTimeout
    setupMockWriteStream(writeStream);

    const p1 = driveCacheManager.getCachedFilePath(fileId);
    const p2 = driveCacheManager.getCachedFilePath(fileId);

    await Promise.all([p1, p2]);

    expect(driveService.getDriveFileStream).toHaveBeenCalledTimes(1);
  });

  it('cleanup deletes files', async () => {
    vi.mocked(fs.promises.readdir).mockResolvedValue(['file1', 'file2'] as any);
    // Clean up uses rmSync
    await driveCacheManager.cleanup();
    expect(fs.rmSync).toHaveBeenCalled();
  });

  it('cleanup handles error', async () => {
    vi.mocked(fs.rmSync).mockImplementation(() => {
      throw new Error('Delete fail');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    driveCacheManager.cleanup();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup failed'),
      expect.anything(),
    );
  });

  it('logs stat errors that are not ENOENT', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    statMock().mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'EPERM' }),
    );

    const fileId = 'missing-but-error';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const writeStream = new EventEmitter();
    // Use helper instead of setTimeout
    setupMockWriteStream(writeStream);

    await driveCacheManager.getCachedFilePath(fileId);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to stat cache file'),
      fileId,
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('stream error after ready deletes corrupt file and clears metadata', async () => {
    const fileId = 'corrupt-file';
    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    const mockSourceStream = new EventEmitter();
    (mockSourceStream as any).pipe = vi.fn();
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockSourceStream as any,
    );

    const writeStream = new EventEmitter();
    (writeStream as any).close = vi.fn();
    setupMockWriteStream(writeStream);

    vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);

    await driveCacheManager.getCachedFilePath(fileId);

    mockSourceStream.emit('error', new Error('Stream Dies'));

    // Allow microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fs.promises.unlink).toHaveBeenCalledWith(
      expect.stringContaining(fileId),
    );
  });

  it('resume download is deduped via activeDownloads', async () => {
    const fileId = 'partial-concurrent';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '2000',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockResolvedValue({ size: 500 } as any);

    const writeStream = new EventEmitter();
    (writeStream as any).path = '/tmp/cache/partial';
    setupMockWriteStream(writeStream);

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const [r1, r2] = await Promise.all([
      driveCacheManager.getCachedFilePath(fileId),
      driveCacheManager.getCachedFilePath(fileId),
    ]);

    // Allow the resume download to start
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(driveService.getDriveFileStream).toHaveBeenCalledTimes(1);
    expect(r1.path).toBe(r2.path);
  });

  it('eviction guard prevents concurrent runs when multiple downloads finish together', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue({
      pipe: vi.fn(),
      on: vi.fn(),
    } as any);

    // Block readdir so the first eviction stays in-flight while the second fires
    let unblockReaddir!: () => void;
    vi.mocked(fs.promises.readdir).mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        unblockReaddir = () => resolve([]);
      }) as any,
    );

    const writeStream1 = new EventEmitter();
    const writeStream2 = new EventEmitter();
    let streamCount = 0;
    vi.mocked(fs.createWriteStream).mockImplementation(() => {
      const ws = streamCount++ === 0 ? writeStream1 : writeStream2;
      setTimeout(() => ws.emit('ready'), 0);
      return ws as any;
    });

    const p1 = driveCacheManager.getCachedFilePath('guard-1');
    const p2 = driveCacheManager.getCachedFilePath('guard-2');
    await p1;
    await p2;

    // Both finish events fire synchronously — first sets evictionRunning=true,
    // second sees the flag and returns immediately.
    writeStream1.emit('finish');
    writeStream2.emit('finish');

    await new Promise((resolve) => setTimeout(resolve, 0));

    // readdir called exactly once; second eviction was a no-op
    expect(fs.promises.readdir).toHaveBeenCalledTimes(1);

    unblockReaddir();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('evicts LRU files when cache exceeds limit', async () => {
    const fileId = 'new-file';
    const threeGB = 3 * 1024 ** 3;

    statMock()
      .mockRejectedValueOnce(
        Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
      )
      .mockResolvedValue({ size: threeGB, mtimeMs: 1000 } as any);

    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const writeStream = new EventEmitter();
    setupMockWriteStream(writeStream, { ready: true, finish: true });

    vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);
    vi.mocked(fs.promises.readdir).mockResolvedValue([
      'old-file',
      fileId,
    ] as any);

    await driveCacheManager.getCachedFilePath(fileId);

    // Allow finish event and enforceEviction to run
    await new Promise((resolve) => setTimeout(resolve, 20));

    // old-file (LRU: no accessOrder entry, lowest mtimeMs) should have been evicted
    expect(fs.promises.unlink).toHaveBeenCalledWith(
      expect.stringContaining('old-file'),
    );
  });

  it('invalidateFile removes file and clears metadata cache', async () => {
    const fileId = 'file-to-invalidate';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '500',
      mimeType: 'video/mp4',
    } as any);
    vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);

    // Populate metadata cache
    statMock().mockResolvedValue({ size: 500 } as any);
    await driveCacheManager.getCachedFilePath(fileId);
    expect(driveService.getDriveFileMetadata).toHaveBeenCalledTimes(1);

    await driveCacheManager.invalidateFile(fileId);

    expect(fs.promises.unlink).toHaveBeenCalledWith(
      expect.stringContaining(fileId),
    );

    // Metadata cache should be cleared — next call fetches fresh metadata
    statMock().mockResolvedValue({ size: 500 } as any);
    await driveCacheManager.getCachedFilePath(fileId);
    expect(driveService.getDriveFileMetadata).toHaveBeenCalledTimes(2);
  });

  it('invalidateFile logs error when unlink fails with non-ENOENT error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fileId = 'locked-file';

    vi.mocked(fs.promises.unlink).mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'EPERM' }),
    );

    await driveCacheManager.invalidateFile(fileId);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to invalidate'),
      fileId,
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('logs error when eviction unlink fails', async () => {
    const fileId = 'evict-unlink-fail';
    const threeGB = 3 * 1024 ** 3;

    statMock()
      .mockRejectedValueOnce(
        Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
      )
      .mockResolvedValue({ size: threeGB, mtimeMs: 1000 } as any);

    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '100',
      mimeType: 'video/mp4',
    } as any);

    const mockStream = { pipe: vi.fn(), on: vi.fn() };
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const writeStream = new EventEmitter();
    setupMockWriteStream(writeStream, { ready: true, finish: true });

    vi.mocked(fs.promises.readdir).mockResolvedValue([
      'old-file',
      fileId,
    ] as any);
    vi.mocked(fs.promises.unlink).mockRejectedValue(new Error('Cannot delete'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await driveCacheManager.getCachedFilePath(fileId);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to evict'),
      'old-file',
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('resume download failure is caught and cleans up activeDownloads', async () => {
    const fileId = 'resume-fail-file';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '2000',
      mimeType: 'video/mp4',
    } as any);

    // Partial file exists
    statMock().mockResolvedValue({ size: 500 } as any);

    // Resume download fails before any write stream is set up
    vi.mocked(driveService.getDriveFileStream).mockRejectedValue(
      new Error('Resume failed'),
    );

    const result = await driveCacheManager.getCachedFilePath(fileId);
    expect(result.path).toBeDefined();

    // Allow the rejection and catch callback to run
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Download failed'),
      fileId,
      expect.anything(),
    );
    consoleSpy.mockRestore();
  });

  it('getCacheStatus returns cloud for non-existent file', async () => {
    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );
    const status = await driveCacheManager.getCacheStatus('non-existent');
    expect(status.status).toBe('cloud');
    expect(status.progress).toBe(0);
  });

  it('getCacheStatus returns ready for fully cached file', async () => {
    const fileId = 'fully-cached-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '1000',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockResolvedValue({ size: 1000 } as any);

    const status = await driveCacheManager.getCacheStatus(fileId);
    expect(status.status).toBe('ready');
    expect(status.progress).toBe(1);
  });

  it('getCacheStatus returns syncing when file is actively downloading', async () => {
    const fileId = 'actively-syncing-file';
    const driveService = await import('../../src/main/google-drive-service');
    vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
      size: '1000',
      mimeType: 'video/mp4',
    } as any);

    statMock().mockRejectedValue(
      Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
    );

    const mockStream = new EventEmitter();
    (mockStream as any).pipe = vi.fn();
    vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
      mockStream as any,
    );

    const writeStream = new EventEmitter();
    setupMockWriteStream(writeStream);

    // Start download
    await driveCacheManager.getCachedFilePath(fileId);

    // Mock stat for getCacheStatus to simulate partial download size (e.g. 400 bytes)
    statMock().mockResolvedValue({ size: 400 } as any);

    const status = await driveCacheManager.getCacheStatus(fileId);
    expect(status.status).toBe('syncing');
    expect(status.progress).toBe(0.4);
  });

  it('throws when getting manager before initialization', () => {
    cleanupDriveCacheManager();
    expect(() => getDriveCacheManager()).toThrow(
      'DriveCacheManager has not been initialized.',
    );
  });

  it('cleanupDriveCacheManager is safe when no instance exists', () => {
    cleanupDriveCacheManager();
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    cleanupDriveCacheManager();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  describe('DriveCacheManager Extra Branch Coverage', () => {
    it('throws on invalid fileId values', async () => {
      await expect(driveCacheManager.getCachedFilePath('')).rejects.toThrow(
        'Invalid fileId',
      );
      await expect(
        driveCacheManager.getCachedFilePath(null as any),
      ).rejects.toThrow('Invalid fileId');
      await expect(driveCacheManager.getCachedFilePath('..')).rejects.toThrow(
        'Invalid fileId',
      );
      await expect(
        driveCacheManager.getCachedFilePath('foo/bar'),
      ).rejects.toThrow('Invalid fileId');
      await expect(
        driveCacheManager.getCachedFilePath('foo\\bar'),
      ).rejects.toThrow('Invalid fileId');
      await expect(
        driveCacheManager.getCachedFilePath('foo\0bar'),
      ).rejects.toThrow('Invalid fileId');
    });

    it('getCacheStatus handles empty/falsy fileId', async () => {
      const status = await driveCacheManager.getCacheStatus('');
      expect(status.status).toBe('cloud');
      expect(status.progress).toBe(0);
    });

    it('getCacheStatus throws on invalid fileId values', async () => {
      await expect(
        driveCacheManager.getCacheStatus(null as any),
      ).rejects.toThrow('Invalid fileId');
      await expect(driveCacheManager.getCacheStatus('..')).rejects.toThrow(
        'Invalid fileId',
      );
      await expect(driveCacheManager.getCacheStatus('foo/bar')).rejects.toThrow(
        'Invalid fileId',
      );
      await expect(
        driveCacheManager.getCacheStatus('foo\\bar'),
      ).rejects.toThrow('Invalid fileId');
      await expect(
        driveCacheManager.getCacheStatus('foo\0bar'),
      ).rejects.toThrow('Invalid fileId');
    });

    it('getCacheStatus handles metadata fetch failure when not downloading', async () => {
      const fileId = 'metadata-fail-not-downloading';
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockRejectedValue(
        new Error('Meta Fail'),
      );
      statMock().mockResolvedValue({ size: 100 } as any);

      const status = await driveCacheManager.getCacheStatus(fileId);
      expect(status.status).toBe('ready');
      expect(status.progress).toBe(1);
    });

    it('getCacheStatus handles metadata fetch failure when downloading', async () => {
      const fileId = 'metadata-fail-downloading';
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockRejectedValue(
        new Error('Meta Fail'),
      );
      statMock().mockResolvedValue({ size: 100 } as any);

      // Directly mock active downloads to avoid triggering download logic and metadata cache setting
      (driveCacheManager as any).activeDownloads.set(
        fileId,
        Promise.resolve(''),
      );

      const status = await driveCacheManager.getCacheStatus(fileId);
      expect(status.status).toBe('syncing');
      expect(status.progress).toBe(0.5);
    });

    it('getCacheStatus handles metadata size equal to 0', async () => {
      const fileId = 'zero-size-file';
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '0',
        mimeType: 'video/mp4',
      } as any);
      statMock().mockResolvedValue({ size: 0 } as any);

      const status = await driveCacheManager.getCacheStatus(fileId);
      expect(status.status).toBe('ready');
      expect(status.progress).toBe(1);
    });

    it('getCacheStatus returns cloud if file is not fully cached and not actively downloading', async () => {
      const fileId = 'partial-not-downloading';
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '1000',
        mimeType: 'video/mp4',
      } as any);
      statMock().mockResolvedValue({ size: 400 } as any);

      const status = await driveCacheManager.getCacheStatus(fileId);
      expect(status.status).toBe('cloud');
      expect(status.progress).toBe(0.4);
    });

    it('emits progress events on stream data event', async () => {
      const fileId = 'progress-emit-file';
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '1000',
        mimeType: 'video/mp4',
      } as any);

      const mockSourceStream = new EventEmitter();
      (mockSourceStream as any).pipe = vi.fn();
      vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
        mockSourceStream as any,
      );

      const writeStream = new EventEmitter();
      setupMockWriteStream(writeStream);

      const progressSpy = vi.fn();
      driveCacheManager.on('progress', progressSpy);

      await driveCacheManager.getCachedFilePath(fileId);

      // Emit data chunk
      mockSourceStream.emit('data', Buffer.from('hello'));

      expect(progressSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId,
          downloadedBytes: 5,
          progress: 0.005,
        }),
      );
    });

    it('handles unlink error on stream error', async () => {
      const fileId = 'unlink-fail-file';
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '1000',
        mimeType: 'video/mp4',
      } as any);

      const mockSourceStream = new EventEmitter();
      (mockSourceStream as any).pipe = vi.fn();
      vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
        mockSourceStream as any,
      );

      const writeStream = new EventEmitter();
      (writeStream as any).close = vi.fn();
      setupMockWriteStream(writeStream);

      vi.mocked(fs.promises.unlink).mockRejectedValue(
        Object.assign(new Error('Permission denied'), { code: 'EPERM' }),
      );

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      await driveCacheManager.getCachedFilePath(fileId);

      mockSourceStream.emit('error', new Error('Stream Dies'));

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete corrupt file'),
        fileId,
        expect.anything(),
      );
      consoleSpy.mockRestore();
    });

    it('enforceEviction handles readdir failure gracefully', async () => {
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '100',
        mimeType: 'video/mp4',
      } as any);
      const mockStream = { pipe: vi.fn(), on: vi.fn() };
      vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
        mockStream as any,
      );

      const writeStream = new EventEmitter();
      setupMockWriteStream(writeStream, { ready: true, finish: true });

      vi.mocked(fs.promises.readdir).mockRejectedValue(
        new Error('Readdir fail'),
      );

      const result = await driveCacheManager.getCachedFilePath('readdir-fail');
      expect(result.path).toBeDefined();

      // Let finish and enforceEviction run
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('enforceEviction handles single stat failure gracefully', async () => {
      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '100',
        mimeType: 'video/mp4',
      } as any);
      const mockStream = { pipe: vi.fn(), on: vi.fn() };
      vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
        mockStream as any,
      );

      const writeStream = new EventEmitter();
      setupMockWriteStream(writeStream, { ready: true, finish: true });

      vi.mocked(fs.promises.readdir).mockResolvedValue([
        'file1',
        'file2',
      ] as any);
      statMock()
        .mockRejectedValueOnce(
          Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
        ) // getCachedFilePath stat
        .mockRejectedValueOnce(new Error('Stat fail')) // enforceEviction file1 stat
        .mockResolvedValue({ size: 100, mtimeMs: 1000 } as any); // enforceEviction file2 stat

      const result = await driveCacheManager.getCachedFilePath('stat-fail');
      expect(result.path).toBeDefined();

      // Let finish and enforceEviction run
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('getDriveCacheManager returns initialized instance', () => {
      const instance = getDriveCacheManager();
      expect(instance).toBeDefined();
      expect(instance).toBe(driveCacheManager);
    });

    it('handles file write stream error during startDownload', async () => {
      const fileId = 'write-error-file';
      statMock().mockRejectedValue(
        Object.assign(new Error('Not Found'), { code: 'ENOENT' }),
      );

      const driveService = await import('../../src/main/google-drive-service');
      vi.mocked(driveService.getDriveFileMetadata).mockResolvedValue({
        size: '100',
        mimeType: 'video/mp4',
      } as any);

      const mockStream = { pipe: vi.fn(), on: vi.fn() };
      vi.mocked(driveService.getDriveFileStream).mockResolvedValue(
        mockStream as any,
      );

      const writeStream = new EventEmitter();
      (writeStream as any).path = '/tmp/cache/write-error';
      setupMockWriteStream(writeStream, { ready: false });

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const promise = driveCacheManager.getCachedFilePath(fileId);

      // Emit error on writeStream
      setTimeout(() => {
        writeStream.emit('error', new Error('Write Failed'));
      }, 10);

      await expect(promise).rejects.toThrow('Write Failed');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('File write error'),
        fileId,
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });
});
