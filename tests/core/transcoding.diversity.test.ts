import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { HlsManager } from '../../src/core/media/hls-manager.ts';
import { generateSessionId } from '../../src/core/media/hls-handler.ts';

// Mock security to allow our test fixtures
vi.mock('../../src/core/auth/security.ts', async () => {
  const actual = (await vi.importActual(
    '../../src/core/auth/security.ts',
  )) as any;
  return {
    ...actual,
    authorizeFilePath: vi.fn().mockImplementation(async (p) => ({
      isAllowed: true,
      realPath: p,
    })),
  };
});

// Mock database to avoid real connections
vi.mock('../../src/core/database/database.ts', () => ({
  getMediaDirectories: vi.fn().mockResolvedValue([]),
  isFileInLibrary: vi.fn().mockResolvedValue(true),
}));

describe('Transcoding Diversity Integration', () => {
  const fixturesDir = path.join(process.cwd(), 'tests/fixtures/diversity');
  const cacheDir = path.join(process.cwd(), 'tests/fixtures/hls-cache');
  let hlsManager: HlsManager;

  beforeAll(async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    hlsManager = HlsManager.getInstance();
    await hlsManager.init(cacheDir);
  });

  afterAll(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const testFiles = [
    'test_libx264_aac.mp4',
    'test_libx264_aac.mkv',
    'test_libx265_aac.mkv',
    'test_libvpx-vp9_libopus.webm',
    'test_mpeg4_mp3.avi',
  ];

  for (const fileName of testFiles) {
    it(`should successfully transcode ${fileName} to HLS`, async () => {
      const filePath = path.join(fixturesDir, fileName);
      const sessionId = await generateSessionId(filePath);

      // Start transcoding
      await hlsManager.ensureSession(sessionId, filePath);

      // Verify session status
      const progress = hlsManager.getSessionProgress(sessionId);
      expect(progress).not.toBeNull();

      // Verify playlist exists and is not empty
      const sessionDir = hlsManager.getSessionDir(sessionId);
      expect(sessionDir).toBeDefined();
      const playlistPath = path.join(sessionDir!, 'playlist.m3u8');
      const stats = await fs.stat(playlistPath);
      expect(stats.size).toBeGreaterThan(0);

      // Clean up session
      await hlsManager.stopSession(sessionId);
    }, 30000); // 30s timeout per file
  }

  it('should handle concurrent transcodes using PQueue', async () => {
    const filesToTranscode = testFiles.slice(0, 3);
    const sessionIds = await Promise.all(
      filesToTranscode.map((f) => generateSessionId(path.join(fixturesDir, f))),
    );

    // Start all concurrently
    await Promise.all(
      filesToTranscode.map((f, i) =>
        hlsManager.ensureSession(sessionIds[i], path.join(fixturesDir, f)),
      ),
    );

    // Verify all are active
    for (const sessionId of sessionIds) {
      const progress = hlsManager.getSessionProgress(sessionId);
      expect(progress).not.toBeNull();
      await hlsManager.stopSession(sessionId);
    }
  }, 60000);
});
