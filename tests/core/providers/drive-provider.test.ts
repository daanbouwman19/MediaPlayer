import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { GoogleDriveProvider } from '../../../src/infrastructure/providers/drive-provider';
import { getDriveStreamWithCache } from '../../../src/core/media/drive-stream';
import {
  listDriveDirectory,
  getDriveFileMetadata,
  getDriveParent,
  getDriveFileThumbnail,
} from '../../../src/main/google-drive-service';

vi.mock('../../../src/core/media/drive-stream', () => ({
  getDriveStreamWithCache: vi.fn(),
}));

vi.mock('../../../src/main/google-drive-service', () => ({
  listDriveDirectory: vi.fn(),
  getDriveFileMetadata: vi.fn(),
  getDriveParent: vi.fn(),
  getDriveFileThumbnail: vi.fn(),
}));

describe('GoogleDriveProvider', () => {
  let provider: GoogleDriveProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new GoogleDriveProvider();
  });

  describe('canHandle', () => {
    it('returns true for gdrive paths', () => {
      expect(provider.canHandle('gdrive://id')).toBe(true);
    });

    it('returns false for others', () => {
      expect(provider.canHandle('/local/path')).toBe(false);
    });
  });

  describe('listDirectory', () => {
    it('lists directory with id', async () => {
      (listDriveDirectory as Mock).mockResolvedValue([]);
      await provider.listDirectory('gdrive://myfolder');
      expect(listDriveDirectory).toHaveBeenCalledWith('myfolder');
    });

    it('lists root if id empty', async () => {
      (listDriveDirectory as Mock).mockResolvedValue([]);
      // provider impl: directoryPath.replace('gdrive://', '') || 'root'
      await provider.listDirectory('gdrive://');
      expect(listDriveDirectory).toHaveBeenCalledWith('root');
    });
  });

  describe('getMetadata', () => {
    it('gets metadata with duration', async () => {
      const apiMeta = {
        size: '1024',
        mimeType: 'video/mp4',
        createdTime: '2021-01-01T00:00:00Z',
        videoMediaMetadata: { durationMillis: '2000' },
      };
      (getDriveFileMetadata as Mock).mockResolvedValue(apiMeta);

      const res = await provider.getMetadata('gdrive://fileid');

      expect(getDriveFileMetadata).toHaveBeenCalledWith('fileid');
      expect(res).toEqual({
        size: 1024,
        mimeType: 'video/mp4',
        lastModified: new Date('2021-01-01T00:00:00Z'),
        duration: 2,
      });
    });

    it('handles missing duration/time', async () => {
      const apiMeta = {};
      (getDriveFileMetadata as Mock).mockResolvedValue(apiMeta);
      const res = await provider.getMetadata('gdrive://fileid');
      expect(res).toEqual({
        size: 0,
        mimeType: 'application/octet-stream',
        lastModified: undefined,
        duration: undefined,
      });
    });
  });

  describe('getStream', () => {
    it('calls getDriveStreamWithCache', async () => {
      const mockResult = { stream: {}, length: 100 };
      (getDriveStreamWithCache as Mock).mockResolvedValue(mockResult);

      const res = await provider.getStream('gdrive://fileid', { start: 0 });

      expect(getDriveStreamWithCache).toHaveBeenCalledWith('fileid', {
        start: 0,
      });
      expect(res).toBe(mockResult);
    });
  });

  describe('getParent', () => {
    it('returns parent path if exists', async () => {
      (getDriveParent as Mock).mockResolvedValue('parentid');
      const res = await provider.getParent('gdrive://childid');
      expect(getDriveParent).toHaveBeenCalledWith('childid');
      expect(res).toBe('gdrive://parentid');
    });

    it('returns null if no parent', async () => {
      (getDriveParent as Mock).mockResolvedValue(null);
      const res = await provider.getParent('gdrive://rootid');
      expect(res).toBeNull();
    });
  });

  describe('resolvePath', () => {
    it('returns same path', async () => {
      expect(await provider.resolvePath('gdrive://abc')).toBe('gdrive://abc');
    });
  });

  describe('getThumbnailStream', () => {
    it('returns stream on success', async () => {
      const mockStream = {};
      (getDriveFileThumbnail as Mock).mockResolvedValue(mockStream);
      const res = await provider.getThumbnailStream('gdrive://abc');
      expect(getDriveFileThumbnail).toHaveBeenCalledWith('abc');
      expect(res).toBe(mockStream);
    });

    it('returns null on failure', async () => {
      (getDriveFileThumbnail as Mock).mockRejectedValue(new Error('Fail'));
      const res = await provider.getThumbnailStream('gdrive://abc');
      expect(res).toBeNull();
    });
  });
});
