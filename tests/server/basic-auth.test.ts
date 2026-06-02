import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/app';
import { createTestMediaService } from '../utils/test-factory';

// Mock dependencies
vi.mock('../../src/core/database/database', () => ({
  initDatabase: vi.fn(),
  getMediaViewCounts: vi.fn(),
  getMetadata: vi.fn(),
  getRecentlyPlayed: vi.fn(),
  getAllMetadataAndStats: vi.fn(),
}));

vi.mock('../../src/core/media/transcode-queue-manager', () => ({
  TranscodeQueueManager: {
    getInstance: vi.fn(() => ({ start: vi.fn(), enqueue: vi.fn() })),
    resetInstance: vi.fn(),
  },
}));

vi.mock('../../src/core/database/worker-factory', () => ({
  WorkerFactory: {
    getWorkerPath: vi.fn().mockResolvedValue({ path: '', options: {} }),
  },
}));

vi.mock('../../src/core/media/hls-manager', () => ({
  HlsManager: {
    getInstance: vi.fn().mockReturnValue({
      setCacheDir: vi.fn(),
    }),
  },
}));

vi.mock('../../src/core/media/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn().mockReturnValue({
      setCacheDir: vi.fn(),
    }),
  },
}));

vi.mock('../../src/main/drive-cache-manager', () => ({
  initializeDriveCacheManager: vi.fn(),
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
  },
}));

vi.mock('../../src/server/middleware/rate-limiters', () => ({
  createRateLimiters: () => ({
    authLimiter: (_req: any, _res: any, next: any) => next(),
    basicAuthLimiter: (_req: any, _res: any, next: any) => next(),
    writeLimiter: (_req: any, _res: any, next: any) => next(),
    readLimiter: (_req: any, _res: any, next: any) => next(),
    fileLimiter: (_req: any, _res: any, next: any) => next(),
    streamLimiter: (_req: any, _res: any, next: any) => next(),
  }),
}));

describe('Basic Authentication Middleware', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should allow access when no credentials are configured', async () => {
    delete process.env.SYSTEM_USER;
    delete process.env.SYSTEM_PASSWORD;

    const { service } = createTestMediaService();
    const app = await createApp(service);
    const response = await request(app).get('/api/albums');
    expect(response.status).not.toBe(401);
  });

  it('should deny access when credentials are configured but missing in request', async () => {
    process.env.SYSTEM_USER = 'admin';
    process.env.SYSTEM_PASSWORD = 'password';

    const { service } = createTestMediaService();
    const app = await createApp(service);
    const response = await request(app).get('/api/albums');
    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toBe(
      'Basic realm="Media Player"',
    );
  });

  it('should deny access when credentials are incorrect', async () => {
    process.env.SYSTEM_USER = 'admin';
    process.env.SYSTEM_PASSWORD = 'password';

    const { service } = createTestMediaService();
    const app = await createApp(service);
    const response = await request(app)
      .get('/api/albums')
      .auth('admin', 'wrongpassword');
    expect(response.status).toBe(401);
  });

  it('should allow access when credentials are correct', async () => {
    process.env.SYSTEM_USER = 'admin';
    process.env.SYSTEM_PASSWORD = 'password';

    const { service } = createTestMediaService();
    const app = await createApp(service);
    const response = await request(app)
      .get('/api/albums')
      .auth('admin', 'password');
    expect(response.status).not.toBe(401);
  });

  it('should allow access when password contains a colon', async () => {
    process.env.SYSTEM_USER = 'admin';
    process.env.SYSTEM_PASSWORD = 'pass:word';

    const { service } = createTestMediaService();
    const app = await createApp(service);
    const response = await request(app)
      .get('/api/albums')
      .auth('admin', 'pass:word');
    expect(response.status).not.toBe(401);
  });

  it('should deny access when credentials do not contain a colon', async () => {
    process.env.SYSTEM_USER = 'admin';
    process.env.SYSTEM_PASSWORD = 'password';

    const { service } = createTestMediaService();
    const app = await createApp(service);
    const response = await request(app)
      .get('/api/albums')
      .set(
        'Authorization',
        'Basic ' + Buffer.from('invalidformat').toString('base64'),
      );
    expect(response.status).toBe(401);
  });
});
