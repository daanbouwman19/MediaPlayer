import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const { mockGetMetadata } = vi.hoisted(() => ({
  mockGetMetadata: vi.fn(),
}));

vi.mock('../../src/infrastructure/fs-provider-factory', () => ({
  getProvider: () => ({ getMetadata: mockGetMetadata }),
}));

import { getFileIdentity } from '../../src/core/media/file-identity';

describe('getFileIdentity', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-identity-'));
    mockGetMetadata.mockReset();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('changes when a local file is replaced or edited', async () => {
    const file = path.join(dir, 'Trip.mp4');
    fs.writeFileSync(file, 'first cut');
    const time = new Date('2024-01-01T00:00:00Z');
    fs.utimesSync(file, time, time);
    const original = await getFileIdentity(file);
    expect(original).toBe(`9-${time.getTime()}`);

    // Same size, newer mtime (re-export under the same name).
    fs.writeFileSync(file, 'next cut!');
    const later = new Date('2024-02-01T00:00:00Z');
    fs.utimesSync(file, later, later);
    expect(await getFileIdentity(file)).not.toBe(original);

    // Replaced by a file with an older mtime but a different size.
    fs.writeFileSync(file, 'restored from backup');
    fs.utimesSync(file, time, time);
    expect(await getFileIdentity(file)).not.toBe(original);
  });

  it('returns null for a missing local file', async () => {
    expect(await getFileIdentity(path.join(dir, 'missing.mp4'))).toBeNull();
  });

  it('uses the provider metadata for Drive files', async () => {
    mockGetMetadata.mockResolvedValue({
      size: 1234,
      mimeType: 'video/mp4',
      lastModified: new Date(5000),
    });
    expect(await getFileIdentity('gdrive://abc')).toBe('1234-5000');
    expect(mockGetMetadata).toHaveBeenCalledWith('gdrive://abc');

    mockGetMetadata.mockResolvedValue({ size: 10, mimeType: 'video/mp4' });
    expect(await getFileIdentity('gdrive://abc')).toBe('10-0');
  });

  it('returns null when Drive metadata is unavailable', async () => {
    mockGetMetadata.mockRejectedValue(new Error('offline'));
    expect(await getFileIdentity('gdrive://abc')).toBeNull();
  });
});
