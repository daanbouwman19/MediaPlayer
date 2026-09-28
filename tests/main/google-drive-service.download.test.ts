import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { google } from 'googleapis';
import { PassThrough } from 'stream';
import * as driveService from '../../src/main/google-drive-service';
import * as googleAuth from '../../src/main/google-auth';

vi.mock('../../src/main/google-auth');
vi.mock('googleapis');

const mockDrive = {
  files: {
    get: vi.fn(),
  },
};

describe('openDriveFileDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    driveService.resetDriveClient();
    (google.drive as any).mockReturnValue(mockDrive);
    (googleAuth.getOAuth2Client as any).mockReturnValue({
      credentials: { refresh_token: 'valid' },
    });
  });

  it('downloads the whole file without a Range header', async () => {
    const stream = new PassThrough();
    mockDrive.files.get.mockResolvedValue({
      data: stream,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4' }),
    });

    const download = await driveService.openDriveFileDownload('file-1');

    expect(download).toEqual({ stream, status: 200, contentRange: null });
    expect(mockDrive.files.get).toHaveBeenCalledWith(
      {
        fileId: 'file-1',
        alt: 'media',
        acknowledgeAbuse: true,
        supportsAllDrives: true,
      },
      { responseType: 'stream', headers: {} },
    );
  });

  it('requests the rest of the file and returns the Content-Range', async () => {
    mockDrive.files.get.mockResolvedValue({
      data: new PassThrough(),
      status: 206,
      headers: new Headers({ 'content-range': 'bytes 100-199/200' }),
    });

    const download = await driveService.openDriveFileDownload('file-1', 100);

    expect(download.status).toBe(206);
    expect(download.contentRange).toBe('bytes 100-199/200');
    expect(mockDrive.files.get).toHaveBeenCalledWith(expect.anything(), {
      responseType: 'stream',
      headers: { Range: 'bytes=100-' },
    });
  });

  it('reads the Content-Range from a plain header record', async () => {
    mockDrive.files.get.mockResolvedValueOnce({
      data: new PassThrough(),
      status: 206,
      headers: { 'content-range': 'bytes 5-9/10' },
    });
    mockDrive.files.get.mockResolvedValueOnce({
      data: new PassThrough(),
      status: 206,
      headers: { 'content-range': ['bytes 5-9/10'] },
    });
    mockDrive.files.get.mockResolvedValueOnce({
      data: new PassThrough(),
      status: 206,
      headers: undefined,
    });

    expect(
      (await driveService.openDriveFileDownload('file-1', 5)).contentRange,
    ).toBe('bytes 5-9/10');
    expect(
      (await driveService.openDriveFileDownload('file-1', 5)).contentRange,
    ).toBe('bytes 5-9/10');
    expect(
      (await driveService.openDriveFileDownload('file-1', 5)).contentRange,
    ).toBeNull();
  });

  it('asks Drive for the revision fields the offline cache relies on', async () => {
    mockDrive.files.get.mockResolvedValue({ data: { id: 'file-1' } });

    await driveService.getDriveFileMetadata('file-1');

    const fields: string = mockDrive.files.get.mock.calls[0][0].fields;
    expect(fields).toContain('md5Checksum');
    expect(fields).toContain('headRevisionId');
    expect(fields).toContain('modifiedTime');
  });
});
