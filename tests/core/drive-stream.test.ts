import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDriveStreamWithCache } from '../../src/core/media/drive-stream';
import fs from 'fs';
import { PassThrough } from 'stream';

const {
  mockGetCachedFilePath,
  mockGetDriveFileStream,
  mockGetDriveFileMetadata,
} = vi.hoisted(() => {
  return {
    mockGetCachedFilePath: vi.fn(),
    mockGetDriveFileStream: vi.fn(),
    mockGetDriveFileMetadata: vi.fn(),
  };
});

vi.mock('../../src/main/drive-cache-manager', () => ({
  getDriveCacheManager: () => ({
    getCachedFilePath: mockGetCachedFilePath,
  }),
}));

vi.mock('../../src/main/google-drive-service', () => ({
  getDriveFileStream: mockGetDriveFileStream,
  getDriveFileMetadata: mockGetDriveFileMetadata,
}));

// We do NOT mock 'fs' module. We use spies.

describe('drive-stream unit tests', () => {
  let statSpy: any;
  let createReadStreamSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup spies
    createReadStreamSpy = vi.spyOn(fs, 'createReadStream');
    statSpy = vi.spyOn(fs.promises, 'stat');
  });

  afterEach(() => {
    if (statSpy) statSpy.mockRestore();
    if (createReadStreamSpy) createReadStreamSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('returns local stream when file is fully cached', async () => {
    const fileId = 'file-123';
    const cachedPath = '/cache/file-123';
    const totalSize = 1000;

    mockGetCachedFilePath.mockResolvedValue({ path: cachedPath, totalSize });
    statSpy.mockResolvedValue({ size: totalSize } as any);

    const mockFsStream = new PassThrough();
    createReadStreamSpy.mockReturnValue(mockFsStream as any);

    const result = await getDriveStreamWithCache(fileId);

    expect(mockGetCachedFilePath).toHaveBeenCalledWith(fileId);
    expect(fs.createReadStream).toHaveBeenCalledWith(cachedPath, {
      start: 0,
      end: 999,
    });
    expect(result.stream).toBe(mockFsStream);
    expect(result.length).toBe(1000);
  });

  it('returns local stream for partial cache hit (start < cachedSize)', async () => {
    const fileId = 'file-123';
    const cachedPath = '/cache/file-123';
    const totalSize = 2000;
    const cachedSize = 1000;

    mockGetCachedFilePath.mockResolvedValue({ path: cachedPath, totalSize });
    statSpy.mockResolvedValue({ size: cachedSize } as any);

    const mockFsStream = new PassThrough();
    createReadStreamSpy.mockReturnValue(mockFsStream as any);

    // Request start 0, which is covered by cache (0-999)
    const result = await getDriveStreamWithCache(fileId, {
      start: 0,
      end: 1999,
    });

    expect(fs.createReadStream).toHaveBeenCalledWith(cachedPath, {
      start: 0,
      end: 999,
    });
    expect(result.stream).toBe(mockFsStream);
    expect(result.length).toBe(1000); // Only serves what is cached
  });

  it('fetches from drive when request starts after cached region', async () => {
    const fileId = 'file-123';
    const cachedPath = '/cache/file-123';
    const totalSize = 2000;
    const cachedSize = 1000;

    mockGetCachedFilePath.mockResolvedValue({ path: cachedPath, totalSize });
    statSpy.mockResolvedValue({ size: cachedSize } as any);

    const mockDriveStream = new PassThrough();
    mockGetDriveFileStream.mockResolvedValue(mockDriveStream);

    // Request start 1000, which is NOT covered by cache (0-999)
    const result = await getDriveStreamWithCache(fileId, {
      start: 1000,
      end: 1999,
    });

    expect(mockGetDriveFileStream).toHaveBeenCalledWith(fileId, {
      start: 1000,
      end: 1999,
    });
    expect(result.stream).toBe(mockDriveStream);
    expect(result.length).toBe(1000);
  });

  it('falls back to drive metadata and stream on cache error', async () => {
    const fileId = 'file-123';
    mockGetCachedFilePath.mockRejectedValue(new Error('Cache missing'));

    mockGetDriveFileMetadata.mockResolvedValue({ size: '5000' });
    const mockDriveStream = new PassThrough();
    mockGetDriveFileStream.mockResolvedValue(mockDriveStream);

    const result = await getDriveStreamWithCache(fileId);

    expect(mockGetDriveFileMetadata).toHaveBeenCalledWith(fileId);
    expect(mockGetDriveFileStream).toHaveBeenCalledWith(fileId, undefined);
    expect(result.stream).toBe(mockDriveStream);
    expect(result.length).toBe(5000);
  });

  it('handles stat failure by treating cached size as 0', async () => {
    const fileId = 'file-123';
    const cachedPath = '/cache/file-123';
    const totalSize = 1000;

    mockGetCachedFilePath.mockResolvedValue({ path: cachedPath, totalSize });
    statSpy.mockRejectedValue(new Error('Stat failed'));

    const mockDriveStream = new PassThrough();
    mockGetDriveFileStream.mockResolvedValue(mockDriveStream);

    // Since stat failed, cachedSize is 0. Request start 0 >= 0, so it fetches from drive.
    const result = await getDriveStreamWithCache(fileId);

    expect(mockGetDriveFileStream).toHaveBeenCalledWith(fileId, {
      start: 0,
      end: 999,
    });
    expect(result.stream).toBe(mockDriveStream);
  });
});
