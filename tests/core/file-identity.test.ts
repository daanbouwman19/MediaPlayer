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

vi.mock('../../src/core/media/drive-backend', () => ({
  getDriveFileMetadataCached: mockGetMetadata,
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

  it('keys Drive files by their revision fields', async () => {
    mockGetMetadata.mockResolvedValue({
      size: '1234',
      createdTime: '2024-01-01T00:00:00Z',
      modifiedTime: '2024-03-01T00:00:00Z',
      md5Checksum: 'abc123',
      headRevisionId: 'rev-1',
    });
    expect(await getFileIdentity('gdrive://abc')).toBe('rev-1-1234');
    expect(mockGetMetadata).toHaveBeenCalledWith('abc');

    mockGetMetadata.mockResolvedValue({
      size: '1234',
      md5Checksum: 'abc123',
      modifiedTime: '2024-03-01T00:00:00Z',
    });
    expect(await getFileIdentity('gdrive://abc')).toBe('abc123-1234');

    mockGetMetadata.mockResolvedValue({
      size: '1234',
      modifiedTime: '2024-03-01T00:00:00Z',
    });
    expect(await getFileIdentity('gdrive://abc')).toBe(
      '2024-03-01T00:00:00Z-1234',
    );
  });

  it('changes for a same-size Drive revision with the same createdTime', async () => {
    const base = { size: '1234', createdTime: '2024-01-01T00:00:00Z' };
    mockGetMetadata.mockResolvedValue({
      ...base,
      headRevisionId: 'rev-1',
      modifiedTime: '2024-02-01T00:00:00Z',
    });
    const first = await getFileIdentity('gdrive://abc');

    mockGetMetadata.mockResolvedValue({
      ...base,
      headRevisionId: 'rev-2',
      modifiedTime: '2024-03-01T00:00:00Z',
    });
    const second = await getFileIdentity('gdrive://abc');

    expect(first).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('falls back to size and createdTime without revision fields', async () => {
    mockGetMetadata.mockResolvedValue({
      size: '1234',
      createdTime: new Date(5000).toISOString(),
    });
    expect(await getFileIdentity('gdrive://abc')).toBe('1234-5000');

    mockGetMetadata.mockResolvedValue({ size: '10', createdTime: 'garbage' });
    expect(await getFileIdentity('gdrive://abc')).toBe('10-0');

    mockGetMetadata.mockResolvedValue({});
    expect(await getFileIdentity('gdrive://abc')).toBe('0-0');
  });

  it('returns null when Drive metadata is unavailable', async () => {
    mockGetMetadata.mockRejectedValue(new Error('offline'));
    expect(await getFileIdentity('gdrive://abc')).toBeNull();
  });
});
