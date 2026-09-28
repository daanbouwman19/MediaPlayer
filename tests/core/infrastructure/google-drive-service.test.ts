import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { google } from 'googleapis';
import { EventEmitter } from 'events';
import { gaxios } from 'google-auth-library';
import * as driveService from '../../../src/infrastructure/google-drive-service';
import * as googleAuth from '../../../src/infrastructure/google-auth';

// We need to mock imports BEFORE importing the module under test
vi.mock('../../../src/infrastructure/google-auth');
vi.mock('googleapis');

const mockDrive = {
  files: {
    list: vi.fn(),
    get: vi.fn(),
  },
};

(google.drive as any).mockReturnValue(mockDrive);

/**
 * Produces a real GaxiosError the way googleapis does, by running a gaxios
 * request against a canned Drive error response.
 */
async function driveApiError(
  status: number,
  reason?: string,
  responseType?: 'stream',
): Promise<InstanceType<typeof gaxios.GaxiosError>> {
  const body = {
    error: {
      code: status,
      message: reason ?? 'Request failed',
      errors: reason
        ? [{ domain: 'usageLimits', reason, message: reason }]
        : [],
    },
  };
  try {
    await gaxios.request({
      url: 'https://www.googleapis.com/drive/v3/files/fileId',
      retry: false,
      ...(responseType ? { responseType } : {}),
      fetchImplementation: async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
    });
  } catch (err) {
    if (err instanceof gaxios.GaxiosError) return err;
    throw err;
  }
  throw new Error('Expected the request to fail');
}

describe('Google Drive Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDrive.files.list.mockReset();
    mockDrive.files.get.mockReset();
    driveService.resetDriveClient();
    (googleAuth.getOAuth2Client as any).mockReturnValue({
      credentials: { refresh_token: 'valid' },
    });
  });

  describe('getDriveClient', () => {
    it('should initialize drive client if auth is valid', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      const client = await driveService.getDriveClient();
      expect(client).toBe(mockDrive);
      expect(google.drive).toHaveBeenCalled();
    });

    it('should try to load credentials if not authenticated', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: {}, // empty
      });
      (googleAuth.loadSavedCredentialsIfExist as any).mockResolvedValue(true);

      const client = await driveService.getDriveClient();
      expect(client).toBe(mockDrive);
      expect(googleAuth.loadSavedCredentialsIfExist).toHaveBeenCalled();
    });

    it('should throw if authentication fails', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: {},
      });
      (googleAuth.loadSavedCredentialsIfExist as any).mockResolvedValue(false);

      await expect(driveService.getDriveClient()).rejects.toThrow(
        'User not authenticated',
      );
    });
  });

  describe('getDriveFileStream', () => {
    it('should return a stream', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });
      const mockStream = { pipe: vi.fn(), on: vi.fn() };
      (mockDrive.files.get as any).mockResolvedValue({ data: mockStream });

      const stream = await driveService.getDriveFileStream('fileId');
      expect(stream).toBe(mockStream);
      expect(mockDrive.files.get).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'fileId',
          alt: 'media',
          // Without it Drive returns 404 for shared-drive files.
          supportsAllDrives: true,
        }),
        expect.objectContaining({ responseType: 'stream', headers: {} }),
      );
    });

    it('should use Range header if start/end provided', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      (mockDrive.files.get as any).mockResolvedValue({
        data: new EventEmitter(),
      });

      await driveService.getDriveFileStream('fileId', { start: 0, end: 100 });

      expect(mockDrive.files.get).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ headers: { Range: 'bytes=0-100' } }),
      );
    });

    it('should log stream events', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      const mockStream = new EventEmitter();
      (mockDrive.files.get as any).mockResolvedValue({ data: mockStream });
      console.log = vi.fn();
      console.error = vi.fn();

      await driveService.getDriveFileStream('fileId');

      mockStream.emit('end');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Stream ended'),
        'fileId',
      );

      mockStream.emit('error', new Error('Fail'));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Stream error'),
        'fileId',
        expect.anything(),
      );
    });

    it('should retry on 429', async () => {
      vi.useFakeTimers();
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      (mockDrive.files.get as any)
        .mockRejectedValueOnce({ code: 429 })
        .mockResolvedValueOnce({ data: new EventEmitter() });

      const promise = driveService.getDriveFileStream('fileId');

      await vi.advanceTimersByTimeAsync(2000);

      await promise;

      expect(mockDrive.files.get).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });
  });

  describe('getDriveFileMetadata', () => {
    it('should return metadata', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });
      const mockMeta = { id: 'fileId', size: '100' };
      (mockDrive.files.get as any).mockResolvedValue({ data: mockMeta });

      const meta = await driveService.getDriveFileMetadata('fileId');
      expect(meta).toBe(mockMeta);
    });
  });

  describe('getDriveFileThumbnail', () => {
    it('should return thumbnail stream if link exists', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
        getAccessToken: vi.fn().mockResolvedValue({ token: 'access_token' }),
      });

      const mockMeta = {
        data: {
          thumbnailLink: 'https://lh3.googleusercontent.com/thumb',
          mimeType: 'image/jpeg',
        },
      };
      (mockDrive.files.get as any).mockResolvedValue(mockMeta);

      const mockBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.close();
        },
      });

      const mockFetchResponse = {
        ok: true,
        body: mockBody,
      };

      global.fetch = vi.fn().mockResolvedValue(mockFetchResponse);

      const stream = await driveService.getDriveFileThumbnail('fileId');

      expect(mockDrive.files.get).toHaveBeenCalledWith({
        fileId: 'fileId',
        fields: 'thumbnailLink, mimeType',
        supportsAllDrives: true,
      });

      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toEqual(Buffer.from([1, 2, 3]));
      expect(global.fetch).toHaveBeenCalledWith(
        'https://lh3.googleusercontent.com/thumb',
        {
          headers: { Authorization: 'Bearer access_token' },
        },
      );
    });

    it('should refuse to send the bearer token to a non-Google host', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
        getAccessToken: vi.fn().mockResolvedValue({ token: 'access_token' }),
      });

      const mockMeta = {
        data: { thumbnailLink: 'https://evil.example.com/thumb' },
      };
      (mockDrive.files.get as any).mockResolvedValue(mockMeta);

      global.fetch = vi.fn();

      await expect(
        driveService.getDriveFileThumbnail('fileId'),
      ).rejects.toThrow('Untrusted thumbnail URL host');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should throw if no thumbnail link', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      const mockMeta = { data: { thumbnailLink: null } }; // No link
      (mockDrive.files.get as any).mockResolvedValue(mockMeta);

      await expect(
        driveService.getDriveFileThumbnail('fileId'),
      ).rejects.toThrow('No thumbnail available');
    });

    it('should throw if fetch fails', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
        getAccessToken: vi.fn().mockResolvedValue({ token: 'access_token' }),
      });

      const mockMeta = {
        data: { thumbnailLink: 'https://lh3.googleusercontent.com/thumb' },
      };
      (mockDrive.files.get as any).mockResolvedValue(mockMeta);

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
      });

      await expect(
        driveService.getDriveFileThumbnail('fileId'),
      ).rejects.toThrow('Failed to fetch thumbnail: Not Found');
    });
  });

  describe('listDriveDirectory', () => {
    it('should list files and folders flatly', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      const mockFiles = [
        { id: 'f1', name: 'File.txt', mimeType: 'text/plain' },
        {
          id: 'd1',
          name: 'Folder',
          mimeType: 'application/vnd.google-apps.folder',
        },
      ];

      (mockDrive.files.list as any).mockResolvedValue({
        data: { files: mockFiles },
      });

      const result = await driveService.listDriveDirectory('root');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'File.txt',
        path: 'f1',
        isDirectory: false,
      });
      expect(result[1]).toEqual({
        name: 'Folder',
        path: 'd1',
        isDirectory: true,
      });
      expect(mockDrive.files.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "'root' in parents and trashed = false",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
      );
    });

    it('should handle shortcuts to folders', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      const mockFiles = [
        {
          id: 'shortcut1',
          name: 'Shortcut to Folder',
          mimeType: 'application/vnd.google-apps.shortcut',
          shortcutDetails: {
            targetId: 'folderTargetId',
            targetMimeType: 'application/vnd.google-apps.folder',
          },
        },
      ];

      (mockDrive.files.list as any).mockResolvedValue({
        data: { files: mockFiles },
      });

      const result = await driveService.listDriveDirectory('root');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: 'Shortcut to Folder',
        path: 'folderTargetId', // Should resolve to target ID
        isDirectory: true,
      });
    });

    it('should ignore shortcuts to non-folders (or treat as files if supported)', async () => {
      const mockFiles = [
        {
          id: 'shortcut1',
          name: 'Shortcut to File',
          mimeType: 'application/vnd.google-apps.shortcut',
          shortcutDetails: {
            targetId: 'fileTargetId',
            targetMimeType: 'application/pdf', // Unsupported for now or just file
          },
        },
      ];

      (mockDrive.files.list as any).mockResolvedValue({
        data: { files: mockFiles },
      });

      const result = await driveService.listDriveDirectory('root');

      // Our logic defaults isDirectory to false if not folder
      expect(result).toHaveLength(1);
      expect(result[0].isDirectory).toBe(false);
      expect(result[0].path).toBe('shortcut1'); // Or targetId? Current logic keeps shortcut ID if not folder
    });

    it('should handle errors', async () => {
      (mockDrive.files.list as any).mockRejectedValue(new Error('API Error'));
      await expect(driveService.listDriveDirectory('root')).rejects.toThrow(
        'API Error',
      );
    });

    it('follows nextPageToken until all pages are fetched', async () => {
      (googleAuth.getOAuth2Client as any).mockReturnValue({
        credentials: { refresh_token: 'valid' },
      });

      const listMock = mockDrive.files.list as any;
      listMock.mockReset();

      listMock
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'f1', name: 'File1.jpg', mimeType: 'image/jpeg' }],
            nextPageToken: 'token1',
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'f2', name: 'File2.jpg', mimeType: 'image/jpeg' }],
            nextPageToken: 'token2',
          },
        })
        .mockResolvedValueOnce({
          data: {
            files: [{ id: 'f3', name: 'File3.jpg', mimeType: 'image/jpeg' }],
          },
        });

      const result = await driveService.listDriveDirectory('root');

      expect(result).toHaveLength(3);
      expect(listMock).toHaveBeenCalledTimes(3);
      expect(listMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ pageToken: 'token1' }),
      );
      expect(listMock).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ pageToken: 'token2' }),
      );
    });
  });

  describe('DRIVE_RETRY_OPTIONS', () => {
    const retriesOnce = async (error: unknown) => {
      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockDrive.files.get
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ data: { id: 'fileId', size: '100' } });

        const promise = driveService.getDriveFileMetadata('fileId');
        await vi.advanceTimersByTimeAsync(2000);
        await expect(promise).resolves.toEqual({ id: 'fileId', size: '100' });
      } finally {
        vi.useRealTimers();
      }
      expect(mockDrive.files.get).toHaveBeenCalledTimes(2);
    };

    it.each(['rateLimitExceeded', 'userRateLimitExceeded'])(
      'retries a real 403 %s GaxiosError',
      async (reason) => {
        const error = await driveApiError(403, reason);
        // gaxios 7 never sets the legacy flat `errors` array.
        expect((error as { errors?: unknown }).errors).toBeUndefined();
        await retriesOnce(error);
      },
    );

    it('retries a 403 rate limit on a streamed download, whose body is unparsed', async () => {
      const error = await driveApiError(403, 'userRateLimitExceeded', 'stream');
      expect(typeof error.response?.data).toBe('string');

      vi.useFakeTimers();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        mockDrive.files.get
          .mockRejectedValueOnce(error)
          .mockResolvedValueOnce({ data: new EventEmitter() });
        const promise = driveService.getDriveFileStream('fileId');
        await vi.advanceTimersByTimeAsync(2000);
        await promise;
      } finally {
        vi.useRealTimers();
      }
      expect(mockDrive.files.get).toHaveBeenCalledTimes(2);
    });

    it.each([429, 500, 503])(
      'retries a real %i GaxiosError',
      async (status) => {
        await retriesOnce(await driveApiError(status));
      },
    );

    it('still understands the legacy flat errors array', async () => {
      await retriesOnce({
        code: 403,
        errors: [{ reason: 'userRateLimitExceeded' }],
      });
    });

    it.each([
      [403, 'insufficientFilePermissions'],
      [403, undefined],
      [404, 'notFound'],
    ])('does not retry a real %i %s GaxiosError', async (status, reason) => {
      const error = await driveApiError(status, reason);
      mockDrive.files.get.mockRejectedValue(error);

      await expect(driveService.getDriveFileMetadata('fileId')).rejects.toBe(
        error,
      );
      expect(mockDrive.files.get).toHaveBeenCalledTimes(1);
    });

    it('does not retry network errors (gaxios already retries those)', async () => {
      const error = Object.assign(new Error('socket hang up'), {
        code: 'ECONNRESET',
      });
      mockDrive.files.get.mockRejectedValue(error);

      await expect(driveService.getDriveFileMetadata('fileId')).rejects.toBe(
        error,
      );
      expect(mockDrive.files.get).toHaveBeenCalledTimes(1);
    });
  });

  describe('getDriveFolderInfo', () => {
    it('returns the folder ID and name, including shared-drive folders', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: {
          id: 'folder123',
          name: 'Holiday Videos',
          mimeType: 'application/vnd.google-apps.folder',
        },
      });

      await expect(
        driveService.getDriveFolderInfo('folder123'),
      ).resolves.toEqual({ id: 'folder123', name: 'Holiday Videos' });
      expect(mockDrive.files.get).toHaveBeenCalledWith({
        fileId: 'folder123',
        fields: 'id, name, mimeType, shortcutDetails',
        supportsAllDrives: true,
      });
    });

    it('follows a shortcut to a folder', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: {
          id: 'shortcut1',
          name: 'Team Photos',
          mimeType: 'application/vnd.google-apps.shortcut',
          shortcutDetails: {
            targetId: 'target_folder',
            targetMimeType: 'application/vnd.google-apps.folder',
          },
        },
      });

      await expect(
        driveService.getDriveFolderInfo('shortcut1'),
      ).resolves.toEqual({ id: 'target_folder', name: 'Team Photos' });
    });

    it('falls back to a default name', async () => {
      mockDrive.files.get.mockResolvedValue({
        data: { id: 'f1', mimeType: 'application/vnd.google-apps.folder' },
      });

      await expect(driveService.getDriveFolderInfo('f1')).resolves.toEqual({
        id: 'f1',
        name: 'Google Drive Folder',
      });
    });

    it.each([
      { id: 'file1', name: 'clip.mp4', mimeType: 'video/mp4' },
      {
        id: 'shortcut2',
        name: 'Shortcut to a file',
        mimeType: 'application/vnd.google-apps.shortcut',
        shortcutDetails: { targetId: 'file1', targetMimeType: 'video/mp4' },
      },
    ])('rejects $name with a 400 because it is not a folder', async (data) => {
      mockDrive.files.get.mockResolvedValue({ data });

      await expect(
        driveService.getDriveFolderInfo(data.id),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Not a Google Drive folder',
      });
    });

    it('rejects malformed IDs with a 400 without calling Drive', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await expect(
        driveService.getDriveFolderInfo("x' or '1'='1"),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid folder ID',
      });
      expect(mockDrive.files.get).not.toHaveBeenCalled();
    });
  });

  describe('getDriveParent', () => {
    it('should return parent id', async () => {
      (mockDrive.files.get as any).mockResolvedValue({
        data: { parents: ['parentId'] },
      });

      const parent = await driveService.getDriveParent('childId');
      expect(parent).toBe('parentId');
      expect(mockDrive.files.get).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'childId',
          fields: 'parents',
          supportsAllDrives: true,
        }),
      );
    });

    it('should return null if no parents', async () => {
      (mockDrive.files.get as any).mockResolvedValue({
        data: { parents: [] },
      });
      const parent = await driveService.getDriveParent('childId');
      expect(parent).toBeNull();
    });

    it('should return null for root', async () => {
      const parent = await driveService.getDriveParent('root');
      expect(parent).toBeNull();
    });

    it('should return null on error', async () => {
      (mockDrive.files.get as any).mockRejectedValue(new Error('API Error'));
      const parent = await driveService.getDriveParent('childId');
      expect(parent).toBeNull();
    });
  });
});
