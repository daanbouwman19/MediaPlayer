import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { LocalFileSystemProvider } from '../../../src/infrastructure/providers/local-provider';
import { listDirectory } from '../../../src/core/media/file-system';
import { isDrivePath } from '../../../src/core/media/media-utils';
import { getMimeType } from '../../../src/core/media/utils/mime-types';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

// Mock internal dependencies safe to mock
vi.mock('../../../src/core/media/file-system', () => ({
  listDirectory: vi.fn(),
}));

vi.mock('../../../src/core/media/media-utils', () => ({
  isDrivePath: vi.fn(),
}));

vi.mock('../../../src/core/media/utils/mime-types', () => ({
  getMimeType: vi.fn(),
}));

// REMOVED vi.mock('fs') and vi.mock('fs/promises')

describe('LocalFileSystemProvider', () => {
  let provider: LocalFileSystemProvider;
  let mockStat: any;
  let mockRealpath: any;
  let mockCreateReadStream: any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new LocalFileSystemProvider();

    // Default implementation for isDrivePath in tests
    (isDrivePath as Mock).mockImplementation((path: string) =>
      path.startsWith('gdrive://'),
    );

    // Setup spies
    mockStat = vi.spyOn(fsPromises, 'stat').mockResolvedValue({
      size: 100,
      mtime: new Date('2021-01-01'),
    } as any);

    mockRealpath = vi
      .spyOn(fsPromises, 'realpath')
      .mockResolvedValue('/real/path');

    // fs.createReadStream is on the default export for 'fs'
    mockCreateReadStream = vi
      .spyOn(fs, 'createReadStream')
      .mockReturnValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('canHandle', () => {
    it('returns true for local paths', () => {
      expect(provider.canHandle('/path/to/file')).toBe(true);
      expect(isDrivePath).toHaveBeenCalledWith('/path/to/file');
    });

    it('returns false for gdrive paths', () => {
      expect(provider.canHandle('gdrive://file')).toBe(false);
      expect(isDrivePath).toHaveBeenCalledWith('gdrive://file');
    });
  });

  describe('listDirectory', () => {
    it('calls listDirectory', async () => {
      (listDirectory as Mock).mockResolvedValue([]);
      await provider.listDirectory('/path');
      expect(listDirectory).toHaveBeenCalledWith('/path');
    });
  });

  describe('getMetadata', () => {
    it('returns metadata', async () => {
      const stats = { size: 100, mtime: new Date('2021-01-01') };
      mockStat.mockResolvedValue(stats);
      (getMimeType as Mock).mockReturnValue('text/plain');

      const meta = await provider.getMetadata('/file.txt');

      expect(fsPromises.stat).toHaveBeenCalledWith('/file.txt');
      expect(getMimeType).toHaveBeenCalledWith('/file.txt');
      expect(meta).toEqual({
        size: 100,
        mimeType: 'text/plain',
        lastModified: stats.mtime,
      });
    });
  });

  describe('getStream', () => {
    it('returns stream', async () => {
      const mockStream = {};
      mockCreateReadStream.mockReturnValue(mockStream);

      const result = await provider.getStream('/file.txt', {
        start: 0,
        end: 10,
      });

      expect(fs.createReadStream).toHaveBeenCalledWith('/file.txt', {
        start: 0,
        end: 10,
      });
      expect(result.stream).toBe(mockStream);
    });
  });

  describe('getParent', () => {
    it('returns parent directory', async () => {
      const res = await provider.getParent('/a/b/c');
      expect(res).toBe(path.dirname('/a/b/c'));
    });

    it('returns null if root', async () => {
      // Logic relies on path.dirname behavior
      const res = await provider.getParent('/');
      // If path.dirname('/') === '/', then returns null
      if (path.dirname('/') === '/') {
        expect(res).toBeNull();
      } else {
        // Windows or other behavior handling
        // On windows path.dirname('/') is probably '/' or '\'
        expect(res).toBeNull();
      }
    });

    it('returns null if empty', async () => {
      const res = await provider.getParent('');
      expect(res).toBeNull();
    });
  });

  describe('resolvePath', () => {
    it('resolves real path', async () => {
      mockRealpath.mockResolvedValue('/real/path');
      const res = await provider.resolvePath('/symlink');
      expect(res).toBe('/real/path');
    });

    it('fallbacks to path.resolve', async () => {
      mockRealpath.mockRejectedValue(new Error('Fail'));
      const res = await provider.resolvePath('/some/path');
      expect(res).toBe(path.resolve('/some/path'));
    });
  });

  describe('getThumbnailStream', () => {
    it('returns null', async () => {
      const res = await provider.getThumbnailStream('/path');
      expect(res).toBeNull();
    });
  });
});
