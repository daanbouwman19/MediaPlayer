import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { Router } from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import * as database from '../../src/core/database/database';

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

vi.mock('../../src/core/database/database', () => ({
  initDatabase: vi.fn(),
}));

vi.mock('../../src/main/drive-cache-manager.ts', () => ({
  initializeDriveCacheManager: vi.fn(),
}));

vi.mock('../../src/core/media/hls-manager.ts', () => ({
  HlsManager: {
    getInstance: vi.fn(() => ({
      setCacheDir: vi.fn(),
    })),
  },
}));

vi.mock('../../src/core/media/transcode-queue-manager', () => ({
  TranscodeQueueManager: {
    getInstance: vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn(),
    })),
    resetInstance: vi.fn(),
  },
}));

vi.mock('../../src/core/media/analysis/media-analyzer.ts', () => ({
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

vi.mock('../../src/core/media/media-handler', () => ({
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
    const { createTestMediaService } = await import('../utils/test-factory.ts');
    const { service } = createTestMediaService();
    const { createApp } = await import('../../src/server/server.ts');
    await createApp(service);

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
    const { createTestMediaService } = await import('../utils/test-factory.ts');
    const { service } = createTestMediaService();

    await expect(createApp(service)).rejects.toThrow('process.exit');
    expect(consoleSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs when resuming pending transcode jobs fails', async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = 'true';

    vi.resetModules();
    const { TranscodeQueueManager } =
      await import('../../src/core/media/transcode-queue-manager');
    vi.mocked(TranscodeQueueManager.getInstance).mockReturnValue({
      start: vi.fn().mockRejectedValue(new Error('queue fail')),
      enqueue: vi.fn(),
    } as any);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { createApp } = await import('../../src/server/app.ts');
    const { createTestMediaService } = await import('../utils/test-factory.ts');
    const { service } = createTestMediaService();
    await createApp(service);

    await vi.waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        '[TranscodeQueue] Failed to resume pending jobs:',
        expect.any(Error),
      ),
    );
  });

  describe('in production mode', () => {
    let clientDir: string;

    beforeEach(async () => {
      process.env.NODE_ENV = 'production';
      process.env.VITEST = 'true';
      process.env.SESSION_SECRET = 'test-secret';

      // A stand-in client build outside the source tree.
      clientDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'mediaplayer-client-'),
      );
      await fs.mkdir(path.join(clientDir, 'assets'));
      await fs.writeFile(
        path.join(clientDir, 'index.html'),
        '<!doctype html><html><body id="spa-shell"></body></html>',
      );
      await fs.writeFile(
        path.join(clientDir, 'assets', 'index-abc123.js'),
        'console.log("app");',
      );
    });

    afterEach(async () => {
      await fs.rm(clientDir, { recursive: true, force: true });
    });

    async function createProductionApp() {
      vi.resetModules();
      const { createApp } = await import('../../src/server/app.ts');
      const { createTestMediaService } =
        await import('../utils/test-factory.ts');
      const { service } = createTestMediaService();
      return createApp(service, { clientDistPath: clientDir });
    }

    it('serves index.html for client-side routes', async () => {
      const app = await createProductionApp();
      const res = await request(app).get('/somewhere');

      expect(res.status).toBe(200);
      expect(res.text).toContain('id="spa-shell"');
    });

    it('serves hashed assets with long-lived caching', async () => {
      const app = await createProductionApp();
      const res = await request(app).get('/assets/index-abc123.js');

      expect(res.status).toBe(200);
      expect(res.text).toBe('console.log("app");');
      expect(res.headers['cache-control']).toContain('immutable');
    });
  });
});
