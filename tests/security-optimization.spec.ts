import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../src/core/database.ts', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn().mockResolvedValue([]),
}));

// Mock fs/promises
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    default: {
      ...actual,
      realpath: vi.fn(),
    },
    realpath: vi.fn(),
  };
});

import { authorizeFilePath, clearAuthCache } from '../src/core/security.ts';
import { isFileInLibrary, getMediaDirectories } from '../src/core/database.ts';
import * as fs from 'fs/promises';

describe('authorizeFilePath Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthCache();
  });

  it('should return allowed immediately if file is in library', async () => {
    const filePath = '/library/photo.jpg';

    // Mock isFileInLibrary to return true
    vi.mocked(isFileInLibrary).mockResolvedValue(true);

    const result = await authorizeFilePath(filePath);

    expect(result.isAllowed).toBe(true);
    expect(result.realPath).toBe(filePath);
    expect(isFileInLibrary).toHaveBeenCalledWith(filePath);

    // Should NOT call getMediaDirectories or fs.realpath (optimization!)
    expect(getMediaDirectories).not.toHaveBeenCalled();
    expect(fs.realpath).not.toHaveBeenCalled();
  });

  it('should check cache on subsequent calls', async () => {
    const filePath = '/library/photo.jpg';

    vi.mocked(isFileInLibrary).mockResolvedValue(true);

    // First call
    await authorizeFilePath(filePath);
    expect(isFileInLibrary).toHaveBeenCalledTimes(1);

    // Second call
    await authorizeFilePath(filePath);
    // Should hit cache, not DB
    expect(isFileInLibrary).toHaveBeenCalledTimes(1);
  });

  it('should fall back to standard check if file is NOT in library', async () => {
    const filePath = '/outside/photo.jpg';

    vi.mocked(isFileInLibrary).mockResolvedValue(false);
    vi.mocked(getMediaDirectories).mockResolvedValue([
      { path: '/media' },
    ] as any);

    // fs.realpath will be called by standard check logic
    // We mock it to succeed for the directory check, and then for the file check
    vi.mocked(fs.realpath).mockImplementation(async (p: any) => {
      if (typeof p === 'string' && p.includes('/media')) return '/media'; // Resolve allowed dir
      return '/outside/real_photo.jpg'; // Resolve file
    });

    const result = await authorizeFilePath(filePath);

    expect(result.isAllowed).toBe(false);
    expect(isFileInLibrary).toHaveBeenCalledWith(filePath);
    expect(getMediaDirectories).toHaveBeenCalled();
  });
});
