import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { filterAuthorizedLibraryPaths } from '../../../src/core/media/utils/authorized-paths';
import { authorizeFilePath } from '../../../src/core/auth/security';
import { getMediaDirectories } from '../../../src/core/database/database';

vi.mock('../../../src/core/auth/security', () => ({
  authorizeFilePath: vi.fn(),
}));

vi.mock('../../../src/core/database/database', () => ({
  getMediaDirectories: vi.fn().mockResolvedValue([]),
}));

describe('filterAuthorizedLibraryPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the library spelling of authorized paths, not their real paths', async () => {
    vi.mocked(authorizeFilePath).mockImplementation(async (p) =>
      p.startsWith('/library/')
        ? { isAllowed: true, realPath: `/mnt/real${p}` }
        : { isAllowed: false, message: 'Access denied' },
    );

    const result = await filterAuthorizedLibraryPaths([
      '/library/a.mp4',
      '/etc/shadow',
      '/library/b.jpg',
    ]);

    expect(result).toEqual(['/library/a.mp4', '/library/b.jpg']);
  });

  it('warms the directory cache once for batches', async () => {
    vi.mocked(authorizeFilePath).mockResolvedValue({ isAllowed: true });

    await filterAuthorizedLibraryPaths(['/a', '/b']);
    expect(getMediaDirectories).toHaveBeenCalledTimes(1);

    await filterAuthorizedLibraryPaths(['/a']);
    expect(getMediaDirectories).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for an empty list', async () => {
    expect(await filterAuthorizedLibraryPaths([])).toEqual([]);
    expect(authorizeFilePath).not.toHaveBeenCalled();
  });
});
