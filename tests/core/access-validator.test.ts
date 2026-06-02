import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateFileAccess,
  handleAccessCheck,
} from '../../src/core/auth/access-validator';

const { mockAuthorizeFilePath } = vi.hoisted(() => ({
  mockAuthorizeFilePath: vi.fn(),
}));

vi.mock('../../src/core/auth/security', () => ({
  authorizeFilePath: mockAuthorizeFilePath,
}));

describe('access-validator unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks auth for drive paths (no longer bypassed)', async () => {
    mockAuthorizeFilePath.mockResolvedValue({
      isAllowed: true,
      realPath: 'gdrive://file-id',
    });
    const result = await validateFileAccess('gdrive://file-id');
    expect(result).toEqual({ success: true, path: 'gdrive://file-id' });
    expect(mockAuthorizeFilePath).toHaveBeenCalledWith('gdrive://file-id');
  });

  it('denies unauthorized drive paths', async () => {
    mockAuthorizeFilePath.mockResolvedValue({ isAllowed: false });
    const result = await validateFileAccess('gdrive://unknown-id');
    expect(result).toEqual({
      success: false,
      error: 'Access denied.',
      statusCode: 403,
    });
    expect(mockAuthorizeFilePath).toHaveBeenCalledWith('gdrive://unknown-id');
  });

  it('allows authorized local paths', async () => {
    mockAuthorizeFilePath.mockResolvedValue({
      isAllowed: true,
      realPath: '/local/file',
    });
    const result = await validateFileAccess('/local/file');
    expect(result).toEqual({ success: true, path: '/local/file' });
    expect(mockAuthorizeFilePath).toHaveBeenCalledWith('/local/file');
  });

  it('fails and returns 403 if realPath is undefined to prevent path injection', async () => {
    mockAuthorizeFilePath.mockResolvedValue({
      isAllowed: true,
      realPath: undefined,
    });
    const result = await validateFileAccess('/local/file');
    expect(result).toEqual({
      success: false,
      error: 'Access denied.',
      statusCode: 403,
    });
  });

  it('denies unauthorized local paths', async () => {
    mockAuthorizeFilePath.mockResolvedValue({ isAllowed: false });
    const result = await validateFileAccess('/local/file');
    expect(result).toEqual({
      success: false,
      error: 'Access denied.',
      statusCode: 403,
    });
  });

  it('handles auth error', async () => {
    mockAuthorizeFilePath.mockRejectedValue(new Error('Auth failed'));
    const result = await validateFileAccess('/local/file');
    expect(result).toEqual({
      success: false,
      error: 'Internal server error.',
      statusCode: 500,
    });
  });

  describe('handleAccessCheck', () => {
    it('returns false if access is successful', () => {
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;
      const result = handleAccessCheck(res, { success: true, path: '/file' });
      expect(result).toBe(false);
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns true and sends error response if access failed', () => {
      const res = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;
      const result = handleAccessCheck(res, {
        success: false,
        statusCode: 403,
        error: 'Denied',
      });
      expect(result).toBe(true);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.send).toHaveBeenCalledWith('Denied');
    });

    it('returns true but does not send response if headers sent', () => {
      const res = {
        headersSent: true,
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;
      const result = handleAccessCheck(res, {
        success: false,
        statusCode: 403,
        error: 'Denied',
      });
      expect(result).toBe(true);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
