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

// Helper for boilerplate fs.realpath mocking
const mockRealpath = (mockImpl: (p: any) => Promise<string>) => {
  if ((fs as any).default && (fs as any).default.realpath) {
    vi.mocked((fs as any).default.realpath).mockImplementation(mockImpl);
  }
  vi.mocked(fs.realpath).mockImplementation(mockImpl);
};

const setupRealpathMock = (allowedDir: string, resolvedFile: string) => {
  mockRealpath(async (p: any) => {
    if (typeof p === 'string' && (p === allowedDir || p.includes(allowedDir) && !p.endsWith(resolvedFile.split('/').pop()!))) {
      return allowedDir;
    }
    return resolvedFile;
  });
};

describe('authorizeFilePath Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthCache();
  });

  it('should verify file is in allowed directories even if in library', async () => {
    const filePath = '/library/photo.jpg';

    // Mock isFileInLibrary to return true
    vi.mocked(isFileInLibrary).mockResolvedValue(true);
    vi.mocked(getMediaDirectories).mockResolvedValue([
      { path: '/library' },
    ] as any);

    setupRealpathMock('/library', '/library/photo.jpg');

    const result = await authorizeFilePath(filePath);

    expect(result.isAllowed).toBe(true);
    expect(result.realPath).toBe('/library/photo.jpg');
    expect(isFileInLibrary).toHaveBeenCalledWith(filePath);

    // Should call getMediaDirectories to verify local paths
    expect(getMediaDirectories).toHaveBeenCalled();
  });

  it('should check cache on subsequent calls', async () => {
    const filePath = '/library/photo.jpg';

    vi.mocked(isFileInLibrary).mockResolvedValue(true);
    vi.mocked(getMediaDirectories).mockResolvedValue([
      { path: '/library' },
    ] as any);

    setupRealpathMock('/library', '/library/photo.jpg');

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

    setupRealpathMock('/media', '/outside/real_photo.jpg');

    const result = await authorizeFilePath(filePath);

    expect(result.isAllowed).toBe(false);
    expect(isFileInLibrary).toHaveBeenCalledWith(filePath);
    expect(getMediaDirectories).toHaveBeenCalled();
  });
});
