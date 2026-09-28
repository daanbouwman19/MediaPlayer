import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import { getProvider } from '../../../src/infrastructure/fs-provider-factory';
import { GoogleDriveProvider } from '../../../src/infrastructure/providers/drive-provider';
import { LocalFileSystemProvider } from '../../../src/infrastructure/providers/local-provider';

describe('getProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes gdrive:// paths to the Google Drive provider', () => {
    expect(getProvider('gdrive://file-id')).toBeInstanceOf(GoogleDriveProvider);
  });

  it('routes local paths to the local file system provider', () => {
    expect(getProvider('/media/videos/clip.mp4')).toBeInstanceOf(
      LocalFileSystemProvider,
    );
    expect(getProvider('C:\\Media\\clip.mp4')).toBeInstanceOf(
      LocalFileSystemProvider,
    );
  });

  it('throws when no provider can handle the path', () => {
    vi.spyOn(GoogleDriveProvider.prototype, 'canHandle').mockReturnValue(false);
    vi.spyOn(LocalFileSystemProvider.prototype, 'canHandle').mockReturnValue(
      false,
    );

    expect(() => getProvider('unknown://thing')).toThrow(
      'No provider found for path: unknown://thing',
    );
  });
});
