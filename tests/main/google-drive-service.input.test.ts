import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { google } from 'googleapis';

// Mock imports
vi.mock('../../src/main/google-auth');
vi.mock('googleapis');

const mockDrive = {
  files: {
    list: vi.fn(),
  },
};

(google.drive as any).mockReturnValue(mockDrive);

describe('Google Drive Service Input Validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    (google.drive as any).mockReturnValue(mockDrive);
  });

  it('should prevent query injection in listDriveDirectory', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const googleAuth = await import('../../src/main/google-auth');

    (googleAuth.getOAuth2Client as any).mockReturnValue({
      credentials: { refresh_token: 'valid' },
    });

    const maliciousId = "' or trashed = false or '1'='1";

    // In the vulnerable version, this would generate a malformed query
    // In the secured version, this should throw an error or be sanitized

    try {
      await driveService.listDriveDirectory(maliciousId);
    } catch (e: any) {
      // If it throws "Invalid folder ID", that's good (post-fix)
      if (e.message === 'Invalid folder ID') {
        return;
      }
    }

    // If we reach here, check what was passed to drive.files.list
    const calls = (mockDrive.files.list as any).mock.calls;
    if (calls.length > 0) {
      const query = calls[0][0].q;
      // If the query contains the raw malicious string, it's vulnerable
      if (query.includes(`'${maliciousId}'`)) {
        throw new Error(
          'VULNERABILITY DETECTED: Malicious ID was injected into query: ' +
            query,
        );
      }
    }
  });

  it('should allow valid folder IDs', async () => {
    const driveService = await import('../../src/main/google-drive-service');
    const googleAuth = await import('../../src/main/google-auth');

    (googleAuth.getOAuth2Client as any).mockReturnValue({
      credentials: { refresh_token: 'valid' },
    });

    (mockDrive.files.list as any).mockResolvedValue({ data: { files: [] } });

    const validIds = ['root', '12345', 'AbCdEf_-123'];

    for (const id of validIds) {
      await driveService.listDriveDirectory(id);
      const calls = (mockDrive.files.list as any).mock.calls;
      const lastCall = calls[calls.length - 1];
      const queryId = id === 'root' ? 'root' : id;
      expect(lastCall[0].q).toContain(`'${queryId}' in parents`);
    }
  });
});
