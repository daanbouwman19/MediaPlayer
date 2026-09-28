// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';

const {
  mockGetDriveFileMetadata,
  mockGetDriveFileStream,
  mockListDriveFiles,
  mockInitializeManualCredentials,
  mockGetCachedFilePath,
} = vi.hoisted(() => ({
  mockGetDriveFileMetadata: vi.fn(),
  mockGetDriveFileStream: vi.fn(),
  mockListDriveFiles: vi.fn(),
  mockInitializeManualCredentials: vi.fn(),
  mockGetCachedFilePath: vi.fn(),
}));

vi.mock('../../../src/main/google-drive-service', () => ({
  getDriveFileMetadata: mockGetDriveFileMetadata,
  getDriveFileStream: mockGetDriveFileStream,
  listDriveFiles: mockListDriveFiles,
}));

vi.mock('../../../src/main/google-auth', () => ({
  initializeManualCredentials: mockInitializeManualCredentials,
}));

vi.mock('../../../src/main/drive-cache-manager', () => ({
  getDriveCacheManager: () => ({ getCachedFilePath: mockGetCachedFilePath }),
}));

import { googleDriveBackend } from '../../../src/infrastructure/google-drive-backend';

describe('googleDriveBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates metadata lookups to the Drive service', async () => {
    mockGetDriveFileMetadata.mockResolvedValue({ id: 'f1' });
    await expect(googleDriveBackend.getFileMetadata('f1')).resolves.toEqual({
      id: 'f1',
    });
    expect(mockGetDriveFileMetadata).toHaveBeenCalledWith('f1');
  });

  it('delegates ranged downloads to the Drive service', async () => {
    await googleDriveBackend.getFileStream('f1', { start: 5, end: 9 });
    expect(mockGetDriveFileStream).toHaveBeenCalledWith('f1', {
      start: 5,
      end: 9,
    });
  });

  it('delegates folder listing to the Drive service', async () => {
    await googleDriveBackend.listFolder('folder');
    expect(mockListDriveFiles).toHaveBeenCalledWith('folder');
  });

  it('installs credentials through the OAuth module', () => {
    const tokens = { refresh_token: 'r' };
    googleDriveBackend.setCredentials(tokens);
    expect(mockInitializeManualCredentials).toHaveBeenCalledWith(tokens);
  });

  it('resolves cache files through the Drive cache manager', async () => {
    mockGetCachedFilePath.mockResolvedValue({ path: '/c/f1', totalSize: 3 });
    await expect(googleDriveBackend.getCachedFile('f1')).resolves.toEqual({
      path: '/c/f1',
      totalSize: 3,
    });
  });
});
