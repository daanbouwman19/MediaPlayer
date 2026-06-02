import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  authorizeFilePath,
  isSensitiveFilename,
} from '../../src/core/auth/security';
import * as database from '../../src/core/database/database';
import fs from 'fs/promises';
import path from 'path';

vi.mock('fs/promises', () => {
  return {
    default: {
      realpath: vi.fn(async (p) => p),
    },
  };
});
vi.mock('../../src/core/database/database');

describe('Master Key Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database.getMediaDirectories).mockResolvedValue([
      {
        path: '/allowed',
        type: 'local',
        id: '1',
        name: 'Allowed',
        isActive: true,
      },
    ]);
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) =>
      path.resolve(p),
    );
  });

  it('should block access to master.key', async () => {
    const result = await authorizeFilePath('master.key');
    expect(result.isAllowed).toBe(false);
    expect(result.message).toBe('Access to sensitive file denied');

    const resultAbs = await authorizeFilePath('/allowed/master.key');
    expect(resultAbs.isAllowed).toBe(false);
    expect(resultAbs.message).toBe('Access to sensitive file denied');
  });

  it('isSensitiveFilename should return true for master.key', () => {
    expect(isSensitiveFilename('master.key')).toBe(true);
    expect(isSensitiveFilename('MASTER.KEY')).toBe(true);
    // Variations
    expect(isSensitiveFilename('master.key.bak')).toBe(true);
  });
});
