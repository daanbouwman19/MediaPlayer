import { describe, it, expect, vi, beforeEach } from 'vitest';
import { google } from 'googleapis';
import { Readable } from 'stream';

vi.mock('../../src/main/google-auth');
vi.mock('googleapis');

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

const mockDrive = {
  files: {
    list: vi.fn(),
    get: vi.fn(),
  },
};

(google.drive as any).mockReturnValue(mockDrive);

describe('Google Drive Service Coverage', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Setup default mock behavior for authentication
    const googleAuth = await import('../../src/main/google-auth');
    (googleAuth.getOAuth2Client as any).mockReturnValue({
      credentials: { refresh_token: 'valid_token' },
      getAccessToken: vi.fn().mockResolvedValue({ token: 'access_token' }),
    });
    (googleAuth.loadSavedCredentialsIfExist as any).mockResolvedValue(true);
  });

  // ... (previous tests are fine) ...

  it('getDriveClient returns existing client (memoization)', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const client1 = await driveService.getDriveClient();
    const client2 = await driveService.getDriveClient();

    expect(client1).toBe(client2);
    expect(google.drive).toHaveBeenCalledTimes(1);
  });

  it('listDriveFiles handles undefined files in response', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const listMock = mockDrive.files.list as any;
    listMock.mockResolvedValueOnce({ data: {} });
    listMock.mockResolvedValueOnce({ data: { files: [] } });

    const result = await driveService.listDriveFiles('root');
    expect(result.textures).toEqual([]);
  });

  it('listDriveFiles defaults names', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const listMock = mockDrive.files.list as any;
    listMock.mockResolvedValueOnce({ data: { files: [{ id: 'f1' }] } });
    listMock.mockResolvedValueOnce({
      data: {
        files: [{ id: 'sub1', mimeType: 'application/vnd.google-apps.folder' }],
      },
    });
    listMock.mockResolvedValueOnce({ data: { files: [] } });
    listMock.mockResolvedValueOnce({ data: { files: [] } });

    const result = await driveService.listDriveFiles('root');
    expect(result.textures[0].name).toBe('Untitled');
    expect(result.children[0].name).toBe('Untitled Folder');
  });

  it('listDriveFiles handles pagination', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const listMock = mockDrive.files.list as any;
    listMock.mockResolvedValueOnce({
      data: {
        files: [{ id: 'f1' }],
        nextPageToken: 'token2',
      },
    });
    listMock.mockResolvedValueOnce({
      data: {
        files: [{ id: 'f2' }],
      },
    });
    listMock.mockResolvedValueOnce({ data: { files: [] } });

    const result = await driveService.listDriveFiles('root');
    expect(result.textures).toHaveLength(2);
  });

  it('listDriveFiles handles shortcuts correctly', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const listMock = mockDrive.files.list as any;
    listMock.mockResolvedValueOnce({
      data: {
        files: [
          {
            id: 'sc1',
            mimeType: 'application/vnd.google-apps.shortcut',
            shortcutDetails: {
              targetMimeType: 'image/jpeg',
              targetId: 'target1',
            },
          },
          {
            id: 'sc2',
            mimeType: 'application/vnd.google-apps.shortcut',
            shortcutDetails: {
              targetMimeType: 'application/pdf',
              targetId: 'target2',
            },
          },
        ],
      },
    });
    listMock.mockResolvedValueOnce({
      data: {
        files: [
          {
            id: 'sc_folder',
            mimeType: 'application/vnd.google-apps.shortcut',
            shortcutDetails: {
              targetMimeType: 'application/vnd.google-apps.folder',
              targetId: 'target_folder',
            },
          },
        ],
      },
    });
    listMock.mockResolvedValueOnce({ data: { files: [] } });
    listMock.mockResolvedValueOnce({ data: { files: [] } });

    const result = await driveService.listDriveFiles('root');
    expect(result.textures).toHaveLength(1);
    expect(result.children).toHaveLength(1);
  });

  it('listDriveDirectory handles generic files and shortcuts', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const listMock = mockDrive.files.list as any;
    listMock.mockResolvedValueOnce({
      data: {
        files: [
          { id: 'f1', name: 'File1', mimeType: 'image/jpeg' },
          {
            id: 'd1',
            name: 'Dir1',
            mimeType: 'application/vnd.google-apps.folder',
          },
          {
            id: 's1',
            name: 'ShortcutDir',
            mimeType: 'application/vnd.google-apps.shortcut',
            shortcutDetails: {
              targetMimeType: 'application/vnd.google-apps.folder',
              targetId: 'targetD1',
            },
          },
        ],
      },
    });

    const items = await driveService.listDriveDirectory('root');
    expect(items).toHaveLength(3);
  });

  it('listDriveDirectory handles error', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const listMock = mockDrive.files.list as any;
    listMock.mockRejectedValueOnce(new Error('List failed'));

    await expect(driveService.listDriveDirectory('root')).rejects.toThrow(
      'List failed',
    );
  });

  it('getDriveParent returns parent', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const getMock = mockDrive.files.get as any;
    getMock.mockResolvedValueOnce({ data: { parents: ['p1'] } });
    const p1 = await driveService.getDriveParent('child');
    expect(p1).toBe('p1');

    getMock.mockResolvedValueOnce({ data: { parents: [] } });
    const p2 = await driveService.getDriveParent('child');
    expect(p2).toBeNull();

    getMock.mockRejectedValueOnce(new Error('Fail'));
    const p3 = await driveService.getDriveParent('child');
    expect(p3).toBeNull();

    const p4 = await driveService.getDriveParent('root');
    expect(p4).toBeNull();
  });

  it('getDriveFileThumbnail handles fetch success', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const getMock = mockDrive.files.get as any;
    getMock.mockResolvedValueOnce({
      data: { thumbnailLink: 'https://lh3.googleusercontent.com/thumb' },
    });

    // Mock web stream - create a proper ReadableStream
    const mockStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      body: mockStream,
    });

    const stream = await driveService.getDriveFileThumbnail('id');
    expect(stream).toBeInstanceOf(Readable);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://lh3.googleusercontent.com/thumb',
      expect.objectContaining({
        headers: { Authorization: 'Bearer access_token' },
      }),
    );
  });

  it('getDriveFileThumbnail throws if fetch fails', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const getMock = mockDrive.files.get as any;
    getMock.mockResolvedValueOnce({
      data: { thumbnailLink: 'https://lh3.googleusercontent.com/thumb' },
    });

    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
    });

    await expect(driveService.getDriveFileThumbnail('id')).rejects.toThrow(
      'Failed to fetch thumbnail: Not Found',
    );
  });

  it('getDriveFileThumbnail throws if no link', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const getMock = mockDrive.files.get as any;
    getMock.mockResolvedValueOnce({ data: {} });

    await expect(driveService.getDriveFileThumbnail('id')).rejects.toThrow(
      'No thumbnail available',
    );
  });

  it('getDriveFileStream returns stream', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const getMock = mockDrive.files.get as any;
    const stream = new Readable();
    getMock.mockResolvedValueOnce({ data: stream });

    const result = await driveService.getDriveFileStream('id');
    expect(result).toBe(stream);
  });

  it('getDriveFileMetadata returns metadata', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const getMock = mockDrive.files.get as any;
    const meta = { id: '1', name: 'f' };
    getMock.mockResolvedValueOnce({ data: meta });

    const result = await driveService.getDriveFileMetadata('id');
    expect(result).toEqual(meta);
  });
});
