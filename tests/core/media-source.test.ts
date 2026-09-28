import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { Readable } from 'stream';
import fs from 'fs'; // Import for spying

import {
  LocalMediaSource,
  DriveMediaSource,
  createMediaSource,
} from '../../src/core/media/media-source';
import {
  registerDriveBackend,
  resetDriveBackend,
} from '../../src/core/media/drive-backend';

// Mocks
const {
  mockAuthorizeFilePath,
  mockGetDriveFileMetadata,
  mockGetDriveStreamWithCache,
  mockProxyGetUrlForFile,
} = vi.hoisted(() => ({
  mockAuthorizeFilePath: vi.fn(),
  mockGetDriveFileMetadata: vi.fn(),
  mockGetDriveStreamWithCache: vi.fn(),
  mockProxyGetUrlForFile: vi.fn(),
}));

// REMOVED vi.mock('fs')

vi.mock('../../src/core/auth/security', () => ({
  authorizeFilePath: mockAuthorizeFilePath,
}));

vi.mock('../../src/core/media/drive-stream', () => ({
  getDriveStreamWithCache: mockGetDriveStreamWithCache,
}));

// Mock InternalMediaProxy singleton
vi.mock('../../src/core/media/media-proxy', () => ({
  InternalMediaProxy: {
    getInstance: () => ({
      getUrlForFile: mockProxyGetUrlForFile,
    }),
  },
}));

describe('media-source', () => {
  let mockFsStat: any;
  let mockFsCreateReadStream: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset persistent mocks
    mockAuthorizeFilePath.mockReset();
    mockGetDriveFileMetadata.mockReset();
    mockGetDriveStreamWithCache.mockReset();
    mockProxyGetUrlForFile.mockReset();

    // Fresh Drive backend (and shared metadata cache) for every test
    resetDriveBackend();
    registerDriveBackend({
      getFileMetadata: mockGetDriveFileMetadata,
      getFileStream: vi.fn(),
      listFolder: vi.fn(),
      setCredentials: vi.fn(),
      getCachedFile: vi.fn(),
    });

    // Setup spies
    mockFsStat = vi.spyOn(fs.promises, 'stat');
    mockFsCreateReadStream = vi.spyOn(fs, 'createReadStream');

    // Default implementations
    mockFsStat.mockResolvedValue({ size: 1000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LocalMediaSource', () => {
    const filePath = '/local/file.mp4';
    let source: LocalMediaSource;

    beforeEach(() => {
      source = new LocalMediaSource(filePath);
    });

    it('getFFmpegInput throws if access denied', async () => {
      mockAuthorizeFilePath.mockResolvedValue({ isAllowed: false });
      await expect(source.getFFmpegInput()).rejects.toThrow('Access denied');
    });

    it('getFFmpegInput returns path if allowed', async () => {
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: filePath,
      });
      expect(await source.getFFmpegInput()).toBe(filePath);
    });

    it('getStream throws if access denied', async () => {
      mockAuthorizeFilePath.mockResolvedValue({ isAllowed: false });
      await expect(source.getStream()).rejects.toThrow('Access denied');
    });

    it('getStream creates fs stream', async () => {
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: filePath,
      });
      mockFsStat.mockResolvedValue({ size: 1000 });
      const mockStream = { pipe: vi.fn() };
      mockFsCreateReadStream.mockReturnValue(mockStream);

      const result = await source.getStream();
      expect(result.length).toBe(1000);
      expect(mockFsCreateReadStream).toHaveBeenCalledWith(
        filePath,
        expect.objectContaining({}),
      );
    });

    it('getStream handles range', async () => {
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: filePath,
      });
      mockFsStat.mockResolvedValue({ size: 1000 });
      const mockStream = { pipe: vi.fn() };
      mockFsCreateReadStream.mockReturnValue(mockStream);

      const result = await source.getStream({ start: 100, end: 200 });
      expect(result.length).toBe(101);
      expect(mockFsCreateReadStream).toHaveBeenCalledWith(
        filePath,
        expect.objectContaining({ start: 100, end: 200 }),
      );
    });

    it('getMimeType detects video types', async () => {
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: 'test.mp4',
      });
      const s = new LocalMediaSource('test.mp4');
      expect(await s.getMimeType()).toBe('video/mp4');
    });

    it('getMimeType defaults to octet-stream', async () => {
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: 'test.xyz',
      });
      const s = new LocalMediaSource('test.xyz');
      expect(await s.getMimeType()).toBe('application/octet-stream');
    });

    it('getSize returns stat size', async () => {
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: filePath,
      });
      mockFsStat.mockResolvedValue({ size: 500 });
      expect(await source.getSize()).toBe(500);
    });

    it('getMimeType throws if access denied', async () => {
      mockAuthorizeFilePath.mockResolvedValue({ isAllowed: false });
      await expect(source.getMimeType()).rejects.toThrow('Access denied');
    });
  });

  describe('DriveMediaSource', () => {
    const filePath = 'gdrive://123';
    let source: DriveMediaSource;

    beforeEach(() => {
      source = new DriveMediaSource(filePath);
    });

    it('getFFmpegInput delegates to InternalMediaProxy and appends extension', async () => {
      mockProxyGetUrlForFile.mockResolvedValue(
        'http://proxy/123.mov?token=xyz',
      );
      mockGetDriveFileMetadata.mockResolvedValue({ name: 'video.mov' });

      // Should append .mov to the proxy URL
      expect(await source.getFFmpegInput()).toBe(
        'http://proxy/123.mov?token=xyz',
      );
      expect(mockProxyGetUrlForFile).toHaveBeenCalledWith('123', '.mov');
    });

    it('getFFmpegInput handles missing extension in metadata', async () => {
      mockProxyGetUrlForFile.mockResolvedValue('http://proxy/123?token=xyz');
      mockGetDriveFileMetadata.mockResolvedValue({ name: 'file_without_ext' });

      expect(await source.getFFmpegInput()).toBe('http://proxy/123?token=xyz');
      expect(mockProxyGetUrlForFile).toHaveBeenCalledWith('123', '');
    });

    it('getFFmpegInput handles metadata error gracefully', async () => {
      mockProxyGetUrlForFile.mockResolvedValue('http://proxy/123?token=xyz');
      mockGetDriveFileMetadata.mockRejectedValue(new Error('Fetch failed'));

      expect(await source.getFFmpegInput()).toBe('http://proxy/123?token=xyz');
      expect(mockProxyGetUrlForFile).toHaveBeenCalledWith('123', '');
    });

    it('getStream delegates to drive-stream', async () => {
      const mockStream = new Readable();
      mockGetDriveStreamWithCache.mockResolvedValue({
        stream: mockStream,
        length: 100,
      });
      const result = await source.getStream({ start: 0, end: 10 });
      expect(mockGetDriveStreamWithCache).toHaveBeenCalledWith('123', {
        start: 0,
        end: 10,
      });
      expect(result.length).toBe(100);
    });

    it('getMimeType returns metadata mimeType', async () => {
      mockGetDriveFileMetadata.mockResolvedValue({ mimeType: 'video/mp4' });
      expect(await source.getMimeType()).toBe('video/mp4');
    });

    it('getMimeType fallback on error', async () => {
      mockGetDriveFileMetadata.mockRejectedValue(new Error('fail'));
      expect(await source.getMimeType()).toBe('application/octet-stream');
    });

    it('getSize returns metadata size', async () => {
      mockGetDriveFileMetadata.mockResolvedValue({ size: '999' });
      expect(await source.getSize()).toBe(999);
    });

    it('getSize rejects when Drive reports no size', async () => {
      mockGetDriveFileMetadata.mockResolvedValue({ id: '123' });
      await expect(source.getSize()).rejects.toThrow('no downloadable size');
    });

    it('lower-cases the extension hint', async () => {
      mockProxyGetUrlForFile.mockResolvedValue('http://proxy/123.mkv?token=t');
      mockGetDriveFileMetadata.mockResolvedValue({ name: 'Movie.MKV' });

      await source.getFFmpegInput();
      expect(mockProxyGetUrlForFile).toHaveBeenCalledWith('123', '.mkv');
    });

    it.each([
      ['a query character', 'What.mp4?'],
      ['a fragment character', 'Clip.m#4'],
      ['a space', 'Pt. 2'],
      ['an over-long suffix', 'archive.backup01'],
    ])(
      'drops an extension hint containing %s (it would displace the token)',
      async (_label, name) => {
        mockProxyGetUrlForFile.mockResolvedValue('http://proxy/123?token=t');
        mockGetDriveFileMetadata.mockResolvedValue({ name });

        await source.getFFmpegInput();
        expect(mockProxyGetUrlForFile).toHaveBeenCalledWith('123', '');
      },
    );
  });

  describe('createMediaSource', () => {
    it('creates DriveMediaSource for gdrive:// prefix', () => {
      const s = createMediaSource('gdrive://abc');
      expect(s).toBeInstanceOf(DriveMediaSource);
    });

    it('creates LocalMediaSource otherwise', () => {
      const s = createMediaSource('/local/path');
      expect(s).toBeInstanceOf(LocalMediaSource);
    });
  });

  describe('MediaSource Efficiency', () => {
    it('LocalMediaSource calls fs.stat only once (cached)', async () => {
      const filePath = '/local/file.mp4';
      const source = new LocalMediaSource(filePath);

      // Mock authorization success
      mockAuthorizeFilePath.mockResolvedValue({
        isAllowed: true,
        realPath: filePath,
      });

      // Mock fs.createReadStream
      vi.spyOn(fs, 'createReadStream').mockReturnValue({
        pipe: vi.fn(),
      } as any);

      // Call getSize
      await source.getSize();
      // Call getStream
      await source.getStream();

      // Verify fs.stat was called once (cached)
      expect(fs.promises.stat).toHaveBeenCalledTimes(1);
    });

    it('DriveMediaSource calls getDriveFileMetadata only once (cached)', async () => {
      const filePath = 'gdrive://123';
      const source = new DriveMediaSource(filePath);

      mockGetDriveFileMetadata.mockResolvedValue({
        mimeType: 'video/mp4',
        size: '1000',
      });

      // Call getSize
      await source.getSize();
      // Call getMimeType
      await source.getMimeType();

      // Verify getDriveFileMetadata was called once (cached)
      expect(mockGetDriveFileMetadata).toHaveBeenCalledTimes(1);
    });

    it('DriveMediaSource instances share one metadata lookup per file', async () => {
      // A new source is created for every HTTP request (every seek), so the
      // cache must outlive the instance.
      mockGetDriveFileMetadata.mockResolvedValue({
        mimeType: 'video/mp4',
        size: '1000',
      });

      await new DriveMediaSource('gdrive://123').getSize();
      await new DriveMediaSource('gdrive://123').getMimeType();
      await new DriveMediaSource('gdrive://123').getSize();

      expect(mockGetDriveFileMetadata).toHaveBeenCalledTimes(1);
    });
  });
});
