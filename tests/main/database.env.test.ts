import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getCachedAlbums,
  recordMediaView,
} from '../../src/core/database/database';

describe('Database Environment Specific Logging', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
    // Simulate production environment to trigger logs
    process.env.NODE_ENV = 'production';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('getCachedAlbums should log warning on error in non-test environment', async () => {
    // dbWorker is not initialized, so this will throw and be caught
    const result = await getCachedAlbums();
    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Error getting cached albums'),
    );
  });

  it('recordMediaView should log warning on error in non-test environment', async () => {
    await recordMediaView('/test/path');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Error recording media view'),
    );
  });
});
