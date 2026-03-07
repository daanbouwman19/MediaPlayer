import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Router } from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import path from 'path';
import * as database from '../../src/core/database';

let capturedMediaOptions: any;

vi.mock('../../src/server/routes/media.routes.ts', () => ({
  createMediaRoutes: vi.fn((options) => {
    capturedMediaOptions = options;
    return Router();
  }),
}));

vi.mock('../../src/server/routes/album.routes.ts', () => ({
  createAlbumRoutes: vi.fn(() => Router()),
}));

vi.mock('../../src/server/routes/auth.routes.ts', () => ({
  createAuthRoutes: vi.fn(() => Router()),
}));

vi.mock('../../src/server/routes/system.routes.ts', () => ({
  createSystemRoutes: vi.fn(() => Router()),
}));

vi.mock('../../src/core/database', () => ({
  initDatabase: vi.fn(),
}));

vi.mock('../../src/main/drive-cache-manager.ts', () => ({
  initializeDriveCacheManager: vi.fn(),
}));

vi.mock('../../src/core/hls-manager.ts', () => ({
  HlsManager: {
    getInstance: vi.fn(() => ({
      setCacheDir: vi.fn(),
    })),
  },
}));

vi.mock('../../src/core/analysis/media-analyzer.ts', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn(() => ({
      setCacheDir: vi.fn(),
    })),
  },
}));

const { MockMediaHandler } = vi.hoisted(() => {
  class MockMediaHandler {
    serveMetadata = vi.fn();
    serveThumbnail = vi.fn();
    serveHeatmap = vi.fn();
    serveHeatmapProgress = vi.fn();
    serveHlsMaster = vi.fn();
    serveHlsPlaylist = vi.fn();
    serveHlsSegment = vi.fn();
    serveStaticFile = vi.fn();
  }

  return { MockMediaHandler };
});

vi.mock('../../src/core/media-handler', () => ({
  MediaHandler: MockMediaHandler,
}));

describe('Server app additional coverage', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    capturedMediaOptions = undefined;
    vi.mocked(database.initDatabase).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('wires media handler instance methods', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';

    vi.resetModules();
    const { createApp } = await import('../../src/server/app.ts');

    await createApp();

    expect(capturedMediaOptions).toBeTruthy();
    const handler = capturedMediaOptions.mediaHandler;

    const req = {} as any;
    const res = {} as any;

    await handler.serveHlsMaster(req, res, '/file.mp4');
    await handler.serveHlsPlaylist(req, res, '/file.mp4');
    await handler.serveHlsSegment(req, res, '/file.mp4', 'segment.ts');
    await handler.serveStaticFile(req, res, '/file.mp4');

    expect(handler.serveHlsMaster).toHaveBeenCalledWith(req, res, '/file.mp4');
    expect(handler.serveHlsPlaylist).toHaveBeenCalledWith(
      req,
      res,
      '/file.mp4',
    );
    expect(handler.serveHlsSegment).toHaveBeenCalledWith(
      req,
      res,
      '/file.mp4',
      'segment.ts',
    );
    expect(handler.serveStaticFile).toHaveBeenCalledWith(req, res, '/file.mp4');
  });

  it('logs and exits when initialization fails', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';

    vi.resetModules();
    vi.mocked(database.initDatabase).mockRejectedValue(new Error('DB fail'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as any);

    const { createApp } = await import('../../src/server/app.ts');

    await expect(createApp()).rejects.toThrow('process.exit');
    expect(consoleSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('serves index.html in production mode', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VITEST = 'true';
    process.env.SESSION_SECRET = 'test-secret';

    const clientDir = path.join(process.cwd(), 'src', 'client');
    const indexPath = path.join(clientDir, 'index.html');

    await fs.mkdir(clientDir, { recursive: true });
    await fs.writeFile(indexPath, '<!doctype html><html></html>');

    vi.resetModules();
    const { createApp } = await import('../../src/server/app.ts');

    const app = await createApp();
    const res = await request(app).get('/somewhere');

    expect(res.status).toBe(200);

    await fs.rm(indexPath, { force: true });
  });
});
