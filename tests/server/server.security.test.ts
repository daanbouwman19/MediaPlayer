import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/server';
import * as database from '../../src/core/database/database';
import fs from 'fs/promises';

// Mock dependencies
vi.mock('../../src/core/database/database');
vi.mock('../../src/core/media/media-service');
vi.mock('../../src/core/media/file-system', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/media/file-system')>();
  return {
    ...actual,
    listDirectory: vi.fn(),
  };
});
vi.mock('../../src/core/auth/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/auth/security')>();
  return {
    ...actual,
    authorizeFilePath: vi.fn(),
  };
});
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    realpath: vi.fn((p) => Promise.resolve(p)), // Mock realpath to return input by default
  },
}));
const { MockMediaHandler } = vi.hoisted(() => {
  class MockMediaHandler {
    serveMetadata = vi.fn();
    serveTranscodedStream = vi.fn();
    serveRawStream = vi.fn();
    serveThumbnail = vi.fn();
    serveStaticFile = vi.fn();
    serveHeatmap = vi.fn();
    serveHeatmapProgress = vi.fn();
    serveHlsMaster = vi.fn();
    serveHlsPlaylist = vi.fn();
    serveHlsSegment = vi.fn();
  }

  return { MockMediaHandler };
});

vi.mock('../../src/core/media/media-handler', () => ({
  MediaHandler: MockMediaHandler,
  serveMetadata: vi.fn(),
  serveTranscodedStream: vi.fn(),
  serveRawStream: vi.fn(),
  serveThumbnail: vi.fn(),
  serveStaticFile: vi.fn(),
}));
vi.mock('../../src/main/google-auth');

describe('Server Security', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createTestMediaService } = await import('../utils/test-factory');
    const { service } = createTestMediaService();
    app = await createApp(service);
  });

  describe('POST /api/directories (Sensitive Paths)', () => {
    it('should block adding root directory', async () => {
      const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const response = await request(app)
        .post('/api/directories')
        .send({ path: rootPath });

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/restricted/i);
      expect(database.addMediaDirectory).not.toHaveBeenCalled();
    });

    it('should block adding system directories', async () => {
      const sysPath = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const response = await request(app)
        .post('/api/directories')
        .send({ path: sysPath });

      expect(response.status).toBe(403);
      expect(response.body.error).toMatch(/restricted/i);
      expect(database.addMediaDirectory).not.toHaveBeenCalled();
    });

    it('should allow adding user directories', async () => {
      const userPath =
        process.platform === 'win32'
          ? 'C:\\Users\\User\\Videos'
          : '/home/user/Videos';
      vi.mocked(fs.stat).mockResolvedValue({} as any);

      const response = await request(app)
        .post('/api/directories')
        .send({ path: userPath });

      expect(response.status).toBe(200);
      expect(database.addMediaDirectory).toHaveBeenCalledWith(userPath);
    });
  });

  describe('API Cache Control', () => {
    it('should set no-cache headers for sensitive API endpoints', async () => {
      // /api/media/all is sensitive (metadata)
      vi.mocked(database.getAllMetadataAndStats).mockResolvedValue([]);
      const response = await request(app).get('/api/media/all');

      expect(response.headers['cache-control']).toBe(
        'no-store, no-cache, must-revalidate, proxy-revalidate',
      );
      expect(response.headers['pragma']).toBe('no-cache');
      expect(response.headers['expires']).toBe('0');
      // Surrogate-Control removed as per PR feedback
      expect(response.headers['surrogate-control']).toBeUndefined();
    });

    it('should NOT set no-cache headers for streaming endpoints', async () => {
      // /api/stream is excluded
      // We don't need successful streaming, just headers check
      const response = await request(app).get('/api/stream');

      // Even if it returns 400 (Missing file), headers from middleware should be absent
      expect(response.headers['pragma']).toBeUndefined();
      if (response.headers['cache-control']) {
        // Robust check: Ensure no restrictive directives are present if cache-control exists
        expect(response.headers['cache-control']).not.toContain('no-store');
        expect(response.headers['cache-control']).not.toContain('no-cache');
      }
    });

    it('should NOT set no-cache headers for thumbnails', async () => {
      const response = await request(app).get('/api/thumbnail');
      // Verify middleware didn't run
      expect(response.headers['pragma']).toBeUndefined();
      expect(response.headers['expires']).toBeUndefined();
    });
  });
});
