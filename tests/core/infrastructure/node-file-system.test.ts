import { describe, it, expect, vi } from 'vitest';
import { NodeFileSystem } from '../../../src/infrastructure/node-file-system';
import fs from 'fs/promises';

vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
  },
  stat: vi.fn(),
}));

describe('NodeFileSystem', () => {
  it('calls fs.stat and returns size and birthtime', async () => {
    const nfs = new NodeFileSystem();
    const mockDate = new Date();
    const mockStats = {
      size: 1024,
      birthtime: mockDate,
    };
    vi.mocked(fs.stat).mockResolvedValue(mockStats as any);

    const result = await nfs.stat('/some/path');

    expect(result).toEqual({
      size: 1024,
      birthtime: mockDate,
    });
    expect(fs.stat).toHaveBeenCalledWith('/some/path');
  });
});
