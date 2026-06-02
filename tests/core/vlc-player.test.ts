import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { openMediaInVlc } from '../../src/infrastructure/vlc-player';

const { mockSpawn, mockAuthorizeFilePath, mockFsAccess } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockAuthorizeFilePath: vi.fn(),
  mockFsAccess: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mockSpawn,
  default: { spawn: mockSpawn },
}));

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    default: {
      ...actual,
      access: mockFsAccess,
    },
    access: mockFsAccess,
  };
});

vi.mock('../../src/core/auth/security', () => ({
  authorizeFilePath: mockAuthorizeFilePath,
}));

vi.mock('../../src/infrastructure/vlc-paths', () => ({
  getVlcPath: vi.fn().mockResolvedValue('/usr/bin/vlc'),
}));

describe('vlc-player unit tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Helper to handle the async spawn and timeout pattern in openMediaInVlc
   */
  async function testOpenMediaAndAdvanceTimers(
    filePath: string,
    serverPort: number,
  ) {
    const promise = openMediaInVlc(filePath, serverPort);
    // Wait for spawn to be called, as getVlcPath() is async
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());
    // Fast-forward past the 300ms timeout in openMediaInVlc
    vi.advanceTimersByTime(500);
    return await promise;
  }

  describe('openMediaInVlc', () => {
    const originalPlatform = process.platform;
    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should return error for Drive file if serverPort is 0', async () => {
      const result = await openMediaInVlc('gdrive://123', 0);
      expect(result).toEqual({
        success: false,
        message: 'Local server is not running to stream files.',
      });
    });

    it('should prepare stream url for Drive file', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // Mock spawn to succeed
      const mockChild = { unref: vi.fn(), on: vi.fn() };
      mockSpawn.mockReturnValue(mockChild);

      const result = await testOpenMediaAndAdvanceTimers('gdrive://123', 3000);

      expect(result).toEqual({ success: true });
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/bin/vlc',
        ['--', expect.stringContaining('http://localhost:3000/video/stream')],
        expect.anything(),
      );
    });

    it.each(['--malicious-flag.mp4', '-h.mp4', '--fullscreen'])(
      'should prevent argument injection for filename starting with hyphen: %s',
      async (maliciousFile) => {
        // Arrange
        mockAuthorizeFilePath.mockResolvedValue({ isAllowed: true });
        const mockChild = { unref: vi.fn(), on: vi.fn() };
        mockSpawn.mockReturnValue(mockChild);

        // Act
        const result = await testOpenMediaAndAdvanceTimers(maliciousFile, 3000);

        // Assert
        expect(result).toEqual({ success: true });
        expect(mockSpawn).toHaveBeenCalledWith(
          '/usr/bin/vlc',
          ['--', maliciousFile],
          expect.objectContaining({ detached: true }),
        );
      },
    );

    it('should handle win32 platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockFsAccess.mockResolvedValue(undefined);

      mockAuthorizeFilePath.mockResolvedValue({ isAllowed: true });
      const mockChild = { unref: vi.fn(), on: vi.fn() };
      mockSpawn.mockReturnValue(mockChild);

      const result = await testOpenMediaAndAdvanceTimers('/local.mp4', 3000);
      expect(result).toEqual({ success: true });
    });

    it('should handle darwin platform', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      mockFsAccess.mockResolvedValue(undefined);
      mockAuthorizeFilePath.mockResolvedValue({ isAllowed: true });
      const mockChild = { unref: vi.fn(), on: vi.fn() };
      mockSpawn.mockReturnValue(mockChild);

      const result = await testOpenMediaAndAdvanceTimers('/local.mp4', 3000);
      expect(result).toEqual({ success: true });
    });

    it('should resolve with failure when spawn fails asynchronously', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const mockChild = new EventEmitter();
      (mockChild as any).unref = vi.fn();
      mockSpawn.mockReturnValue(mockChild);
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const promise = openMediaInVlc('gdrive://123', 3000);

      // Wait for spawn to be called (handles async getVlcPath)
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      // Trigger error asynchronously (before timeout)
      mockChild.emit('error', new Error('Spawn Error'));

      const result = await promise;

      expect(consoleSpy).toHaveBeenCalledWith(
        '[vlc-player] Error launching VLC (async):',
        expect.any(Error),
      );
      expect(result).toEqual({
        success: false,
        message: 'Failed to launch VLC: Spawn Error',
      });
      consoleSpy.mockRestore();
    });

    it('should resolve with success after timeout if no error', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const mockChild = new EventEmitter();
      (mockChild as any).unref = vi.fn();
      mockSpawn.mockReturnValue(mockChild);

      const promise = openMediaInVlc('gdrive://123', 3000);

      // Wait for spawn to be called (handles async getVlcPath)
      await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalled());

      // Fast-forward past the 300ms timeout
      vi.advanceTimersByTime(300);

      const result = await promise;
      expect(result).toEqual({ success: true });
      expect((mockChild as any).unref).toHaveBeenCalled();
    });
  });
});
