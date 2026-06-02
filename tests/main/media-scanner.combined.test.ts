import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { performFullMediaScan } from '../../src/core/media/media-scanner';
import * as driveService from '../../src/main/google-drive-service';

// --- Mocks ---

// Hoist the mock object so it can be referenced in the vi.mock factory
const { mockFs } = vi.hoisted(() => {
  return {
    mockFs: {
      access: vi.fn(),
      readdir: vi.fn(),
      stat: vi.fn(),
    },
  };
});

// Mock fs/promises using the hoisted object
vi.mock('fs/promises', () => {
  return {
    default: mockFs,
    access: mockFs.access,
    readdir: mockFs.readdir,
    stat: mockFs.stat,
  };
});

vi.mock('../../src/main/google-drive-service', () => ({
  listDriveFiles: vi.fn(),
}));

describe('Media Scanner Combined', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- From media-scanner.test.ts ---
  describe('Basic Scanning', () => {
    it('should scan local directories recursively', async () => {
      const rootDir = '/test/media';
      const imageFile = 'image.jpg';
      const videoFile = 'video.mp4';

      // Mock fs structure
      mockFs.access.mockResolvedValue(undefined); // Access ok

      // Mock readdir for root
      mockFs.readdir.mockResolvedValueOnce([
        { name: 'subdir', isDirectory: () => true, isFile: () => false },
        { name: imageFile, isDirectory: () => false, isFile: () => true },
      ]);

      // Mock readdir for subdir
      mockFs.readdir.mockResolvedValueOnce([
        { name: videoFile, isDirectory: () => false, isFile: () => true },
      ]);

      const result = await performFullMediaScan([rootDir]);

      expect(result).toHaveLength(1);
      const rootAlbum = result[0];
      expect(rootAlbum.name).toBe('media');
      expect(rootAlbum.textures).toHaveLength(1);
      expect(rootAlbum.textures[0].name).toBe(imageFile);

      expect(rootAlbum.children).toHaveLength(1);
      const childAlbum = rootAlbum.children[0];
      expect(childAlbum.name).toBe('subdir');
      expect(childAlbum.textures).toHaveLength(1);
      expect(childAlbum.textures[0].name).toBe(videoFile);
    });

    it('should scan google drive folders', async () => {
      const drivePath = 'gdrive://folder-id';
      const mockAlbum = {
        name: 'Drive Folder',
        textures: [{ name: 'file.jpg', path: 'gdrive://f1' }],
        children: [],
      };

      (driveService.listDriveFiles as any).mockResolvedValue(mockAlbum);

      const result = await performFullMediaScan([drivePath]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockAlbum);
      expect(driveService.listDriveFiles).toHaveBeenCalledWith('folder-id');
    });

    it('should handle scan errors gracefully', async () => {
      mockFs.access.mockRejectedValue(new Error('Access denied'));
      const result = await performFullMediaScan(['/bad/path']);
      expect(result).toEqual([]);
    });

    it('should handle drive scan errors gracefully', async () => {
      (driveService.listDriveFiles as any).mockRejectedValue(
        new Error('Network error'),
      );

      const result = await performFullMediaScan(['gdrive://bad-id']);

      expect(result).toEqual([]);
    });

    // Coverage tests
    it('should ignore unsupported files', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        { name: 'text.txt', isDirectory: () => false, isFile: () => true },
      ]);

      const result = await performFullMediaScan(['/test']);
      // Should be empty or null if no media found.
      // performFullMediaScan filters nulls.
      // scanDirectoryRecursive returns null if no textures/children.
      expect(result).toEqual([]);
    });

    it('should handle readdir errors', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockRejectedValue(new Error('Read error'));

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const result = await performFullMediaScan(['/test']);

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('should ignore special files (sockets/symlinks)', async () => {
      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        { name: 'socket', isDirectory: () => false, isFile: () => false },
      ]);

      const result = await performFullMediaScan(['/test']);
      expect(result).toEqual([]);
    });

    it('should return null for empty drive folders', async () => {
      const drivePath = 'gdrive://empty-id';
      const mockAlbum = {
        name: 'Empty Folder',
        textures: [],
        children: [],
      };

      (driveService.listDriveFiles as any).mockResolvedValue(mockAlbum);

      const result = await performFullMediaScan([drivePath]);
      expect(result).toEqual([]);
    });
  });

  // --- From media-scanner.coverage.test.ts ---
  describe('Coverage & Logging', () => {
    it('performFullMediaScan handles fs.access failure', async () => {
      mockFs.access.mockRejectedValueOnce(new Error('Access denied'));
      const results = await performFullMediaScan(['/bad/dir']);
      expect(results).toEqual([]);
    });

    it('performFullMediaScan logs error in non-test env', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mockFs.access.mockRejectedValueOnce(new Error('Access denied'));

      await performFullMediaScan(['/bad/dir']);

      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('scanDirectoryRecursive handles fs.readdir failure', async () => {
      mockFs.access.mockResolvedValue(undefined); // Base access ok
      mockFs.readdir.mockRejectedValue(new Error('Read fail'));

      const results = await performFullMediaScan(['/base']);
      expect(results).toEqual([]);
    });

    it('scanDirectoryRecursive logs error in non-test env', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockRejectedValue(new Error('Read fail'));

      await performFullMediaScan(['/base']);

      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    });

    it('filters out null albums (empty/unsupported dirs)', async () => {
      mockFs.access.mockResolvedValue(undefined);
      // Mock readdir to return empty or unsupported files
      mockFs.readdir.mockResolvedValue([
        {
          name: 'ignored.txt',
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);

      const results = await performFullMediaScan(['/base']);
      expect(results).toEqual([]);
    });

    it('logs found files and stats in non-test env', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const consoleLogSpy = vi
        .spyOn(console, 'log')
        .mockImplementation(() => {});

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockResolvedValue([
        {
          name: 'image.jpg',
          isFile: () => true,
          isDirectory: () => false,
        } as any,
      ]);

      await performFullMediaScan(['/base']);

      expect(consoleLogSpy).toHaveBeenCalled();
      // Verify specific logs if needed, but just calling is enough for coverage
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(/\[MediaScanner\] Found file: .*image\.jpg/),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[MediaScanner] Folder: base - Files: 1'),
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('root albums with 1 total files'),
      );

      consoleLogSpy.mockRestore();
      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  // --- From media-scanner.errors.test.ts ---
  describe('Error Handling', () => {
    it('should handle access errors gracefully for a specific directory', async () => {
      const badDir = '/bad/dir';
      const goodDir = '/good/dir';

      mockFs.access.mockImplementation(async (path: any) => {
        if (path === badDir) {
          throw new Error('Permission denied');
        }
        return Promise.resolve();
      });

      // Mock readdir for the good directory to return empty, so we don't need deeper mocking
      mockFs.readdir.mockResolvedValue([]);

      const result = await performFullMediaScan([badDir, goodDir]);

      // Should not throw, should return empty array because goodDir is empty and badDir failed
      expect(result).toEqual([]);
      expect(mockFs.access).toHaveBeenCalledTimes(2);
      expect(mockFs.access).toHaveBeenCalledWith(badDir);
      expect(mockFs.access).toHaveBeenCalledWith(goodDir);
    });

    it('should handle readdir errors gracefully inside scanDirectoryRecursive', async () => {
      const baseDir = '/base/dir';

      mockFs.access.mockResolvedValue(undefined);
      mockFs.readdir.mockRejectedValue(new Error('Read failure'));

      const result = await performFullMediaScan([baseDir]);

      expect(result).toEqual([]);
      expect(mockFs.readdir).toHaveBeenCalledWith(baseDir, {
        withFileTypes: true,
      });
    });

    it('should handle errors during the entire scan process gracefully', async () => {
      const promiseAllSpy = vi
        .spyOn(Promise, 'all')
        .mockRejectedValue(new Error('Catastrophic failure'));

      const result = await performFullMediaScan(['/dir']);

      expect(result).toEqual([]);

      promiseAllSpy.mockRestore();
    });
  });
});
