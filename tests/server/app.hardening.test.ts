/**
 * createApp() wiring with the real rate limiters, auth middlewares, body
 * parser and error handler: basic-auth lockout and cost, fail-closed
 * configuration, session signing, body parsing order, the API 404 and the
 * separate telemetry budget.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../../src/server/app';
import { resetBasicAuthState } from '../../src/server/middleware/basic-auth';
import { createTestMediaService } from '../utils/test-factory';

vi.mock('../../src/core/database/database', () => ({
  initDatabase: vi.fn(),
  getMediaViewCounts: vi.fn().mockResolvedValue({}),
  getMetadata: vi.fn(),
  getRecentlyPlayed: vi.fn(),
  getAllMetadataAndStats: vi.fn(),
  getMediaDirectories: vi.fn().mockResolvedValue([]),
  recordMediaView: vi.fn(),
  updatePlaybackPosition: vi.fn(),
  setRating: vi.fn(),
}));

vi.mock('../../src/core/auth/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/auth/security')>();
  return {
    ...actual,
    authorizeFilePath: vi.fn().mockResolvedValue({ isAllowed: true }),
    filterAuthorizedPaths: vi.fn(async (paths: string[]) => paths),
  };
});

vi.mock('../../src/core/media/transcode-queue-manager', () => ({
  TranscodeQueueManager: {
    getInstance: vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn(),
    })),
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
    getInstance: vi.fn().mockReturnValue({ setCacheDir: vi.fn() }),
  },
}));

vi.mock('../../src/core/media/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: vi.fn().mockReturnValue({ setCacheDir: vi.fn() }),
  },
}));

vi.mock('../../src/infrastructure/drive-cache-manager', () => ({
  initializeDriveCacheManager: vi.fn(),
}));

vi.mock('../../src/infrastructure/google-auth', () => ({
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.example/auth'),
  authenticateWithCode: vi.fn(),
  checkGoogleDriveAuth: vi.fn().mockResolvedValue(false),
  getPendingAuthState: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { mkdir: vi.fn() },
}));

async function buildApp() {
  const { service } = createTestMediaService();
  return createApp(service);
}

/** Signs a cookie-session payload the way cookie-session/keygrip do. */
function forgeSession(payload: object, key: string): string {
  const urlSafe: Record<string, string> = { '/': '_', '+': '-', '=': '' };
  const value = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto
    .createHmac('sha1', key)
    .update(`session=${value}`)
    .digest('base64')
    .replace(/\/|\+|=/g, (c) => urlSafe[c] ?? '');
  return `session=${value}; session.sig=${sig}`;
}

describe('createApp hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBasicAuthState();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SYSTEM_USER', '');
    vi.stubEnv('SYSTEM_PASSWORD', '');
    vi.stubEnv('GLOBAL_PASSWORD', '');
    vi.stubEnv('SESSION_SECRET', '');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('Basic Auth', () => {
    beforeEach(() => {
      vi.stubEnv('SYSTEM_USER', 'admin');
      vi.stubEnv('SYSTEM_PASSWORD', 'pass:word');
    });

    it('does not lock out an authenticated client that gets 404s', async () => {
      const app = await buildApp();
      for (let i = 0; i < 25; i++) {
        const res = await request(app)
          .get('/api/no-such-endpoint')
          .auth('admin', 'pass:word');
        expect(res.status).toBe(404);
      }

      const res = await request(app)
        .get('/api/albums')
        .auth('admin', 'pass:word');
      expect(res.status).toBe(200);
    });

    it('does not count requests without credentials as failures', async () => {
      const app = await buildApp();
      for (let i = 0; i < 25; i++) {
        const res = await request(app).get('/api/albums');
        expect(res.status).toBe(401);
      }

      const res = await request(app)
        .get('/api/albums')
        .auth('admin', 'pass:word');
      expect(res.status).toBe(200);
    });

    it('locks out a client after repeated wrong passwords, even for a right guess', async () => {
      const app = await buildApp();
      for (let i = 0; i < 20; i++) {
        const res = await request(app)
          .get('/api/albums')
          .auth('admin', `guess-${i}`);
        expect(res.status).toBe(401);
      }

      const res = await request(app)
        .get('/api/albums')
        .auth('admin', 'pass:word');
      expect(res.status).toBe(429);
    });

    it('does not run scrypt on the request path', async () => {
      const scrypt = vi.spyOn(crypto, 'scryptSync');
      const app = await buildApp();
      for (let i = 0; i < 3; i++) {
        await request(app).get('/api/albums').auth('admin', 'pass:word');
        await request(app).get('/api/albums').auth('admin', 'wrong');
      }
      expect(scrypt).not.toHaveBeenCalled();
    });

    it.each([
      ['SYSTEM_USER', 'SYSTEM_PASSWORD'],
      ['SYSTEM_PASSWORD', 'SYSTEM_USER'],
    ])('fails closed when only %s is set', async (_set, unset) => {
      vi.stubEnv(unset, '');
      const app = await buildApp();

      const res = await request(app).get('/api/albums');

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: 'Server authentication is misconfigured',
      });
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Basic Auth is misconfigured'),
      );
    });
  });

  describe('session signing without SESSION_SECRET', () => {
    const formerDevKey = 'media-player-dev-secret-do-not-use-in-prod';

    /**
     * An unlocked session for GLOBAL_PASSWORD 'secret' that passes every
     * payload check, signed with and fingerprinted under the former
     * hard-coded development key.
     */
    function forgeUnlockedSession(): string {
      const fingerprintKey = crypto
        .createHmac('sha256', formerDevKey)
        .update('media-player:global-password-session')
        .digest();
      const passwordFingerprint = crypto
        .createHmac('sha256', fingerprintKey)
        .update('secret', 'utf8')
        .digest('base64url');
      return forgeSession(
        { isAuthenticated: true, authAt: Date.now(), passwordFingerprint },
        formerDevKey,
      );
    }

    beforeEach(() => {
      vi.stubEnv('GLOBAL_PASSWORD', 'secret');
    });

    it('accepts the forged session when the app signs with that key (control)', async () => {
      vi.stubEnv('SESSION_SECRET', formerDevKey);
      const app = await buildApp();

      const res = await request(app)
        .get('/api/albums')
        .set('Cookie', forgeUnlockedSession());

      expect(res.status).toBe(200);
    });

    it('rejects a session forged with the former built-in development key', async () => {
      const app = await buildApp();

      const res = await request(app)
        .get('/api/albums')
        .set('Cookie', forgeUnlockedSession());

      expect(res.status).toBe(401);
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('SESSION_SECRET is not set'),
      );
    });
  });

  describe('JSON body parsing', () => {
    it('does not parse bodies of locked-out clients', async () => {
      vi.stubEnv('GLOBAL_PASSWORD', 'secret');
      const app = await buildApp();

      const res = await request(app)
        .post('/api/media/views')
        .set('Content-Type', 'application/json')
        .send('{"filePaths": [not json');

      // Rejected by the lock before the body parser ever sees it.
      expect(res.status).toBe(401);
    });

    it('limits bodies to 1mb', async () => {
      const app = await buildApp();

      const res = await request(app)
        .post('/api/media/views')
        .send({ filePaths: ['a'.repeat(1.5 * 1024 * 1024)] });

      expect(res.status).toBe(413);
      expect(res.body).toEqual({ error: 'Payload Too Large' });
    });

    it('answers 400 for malformed JSON from an allowed client', async () => {
      const app = await buildApp();

      const res = await request(app)
        .post('/api/media/views')
        .set('Content-Type', 'application/json')
        .send('{"filePaths": [not json');

      expect(res.status).toBe(400);
    });
  });

  describe('unknown API endpoints', () => {
    it('answer a JSON 404 in production instead of the SPA index', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('SESSION_SECRET', 'test-secret');
      const app = await buildApp();

      const res = await request(app).get('/api/removed-endpoint');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.body).toEqual({ error: 'Not found' });
    });
  });

  describe('telemetry rate limiting', () => {
    it('keeps view and playback-position writes out of the strict write budget', async () => {
      const app = await buildApp();

      // More than the 10/min write budget, as a slideshow and a playing
      // video produce within a minute.
      for (let i = 0; i < 15; i++) {
        const view = await request(app)
          .post('/api/media/view')
          .send({ filePath: `/media/${i}.jpg` });
        expect(view.status).toBe(200);
        const position = await request(app)
          .post('/api/media/playback-position')
          .send({ filePath: '/media/clip.mp4', position: i * 5 });
        expect(position.status).toBe(200);
      }

      const rating = await request(app)
        .post('/api/media/rate')
        .send({ filePath: '/media/clip.mp4', rating: 4 });
      expect(rating.status).toBe(200);
    });
  });
});
