import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/server';
import { authenticateWithCode } from '../../src/main/google-auth';
import { createTestMediaService } from '../utils/test-factory';

vi.mock('../../src/core/database', () => ({
  initDatabase: vi.fn(),
  addMediaDirectory: vi.fn().mockResolvedValue(undefined),
  getMediaDirectories: vi.fn().mockResolvedValue([]),
  removeMediaDirectory: vi.fn(),
  setDirectoryActiveState: vi.fn(),
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  upsertMetadata: vi.fn(),
  getMetadata: vi.fn(),
  createSmartPlaylist: vi.fn(),
  getSmartPlaylists: vi.fn(),
  deleteSmartPlaylist: vi.fn(),
  updateSmartPlaylist: vi.fn(),
  setRating: vi.fn(),
  getAllMetadataAndStats: vi.fn(),
  getRecentlyPlayed: vi.fn(),
}));

vi.mock('../../src/core/transcode-queue-manager', () => ({
  TranscodeQueueManager: {
    getInstance: vi.fn(() => ({ start: vi.fn(), enqueue: vi.fn() })),
    resetInstance: vi.fn(),
  },
}));

vi.mock('../../src/main/google-auth', () => ({
  generateAuthUrl: vi.fn(),
  authenticateWithCode: vi.fn(),
}));
vi.mock('../../src/main/drive-cache-manager', () => ({
  initializeDriveCacheManager: vi.fn(),
}));
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({}),
    realpath: vi.fn((p) => Promise.resolve(p)),
  },
}));
vi.mock('../../src/core/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/security')>();
  return {
    ...actual,
    authorizeFilePath: vi.fn().mockResolvedValue({ isAllowed: true }),
    isSensitiveDirectory: vi.fn().mockReturnValue(false),
  };
});

describe('Server DoS Protection', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { service } = createTestMediaService();
    app = await createApp(service);
  });

  it('should reject large JSON bodies', async () => {
    // Create a large object string > 10MB
    const largeString = 'a'.repeat(11 * 1024 * 1024);

    const response = await request(app)
      .post('/api/media/views') // Any POST endpoint
      .set('Content-Type', 'application/json')
      .send({ filePaths: [largeString] });

    // Express default is 100kb, but we expect to set it to 10mb.
    // If we send 11MB, it should fail with 413 Payload Too Large.
    expect(response.status).toBe(413);
  });

  it('should rate limit the Google Auth endpoint', async () => {
    // Mock successful auth to avoid other errors
    vi.mocked(authenticateWithCode).mockResolvedValue(undefined as any);

    const LIMIT = 20; // Matches our planned limit
    const code = 'test-code';

    // Send requests up to the limit
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app)
        .post('/api/auth/google-drive/code')
        .send({ code });
      expect(res.status).toBe(200);
    }

    // Next one should fail
    const blockedRes = await request(app)
      .post('/api/auth/google-drive/code')
      .send({ code });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toMatch(/too many auth attempts/i);
  });

  it('should rate limit directory additions', async () => {
    const LIMIT = 10;
    const path = '/tmp/test';

    // Send requests up to the limit
    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app).post('/api/directories').send({ path });
      if (res.status !== 200) {
        console.log(`Directories Failed at ${i}: ${res.status}`);
      }
      expect(res.status).toBe(200);
    }

    // Next one should fail
    const blockedRes = await request(app)
      .post('/api/directories')
      .send({ path });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toMatch(/too many requests/i);
  });

  it('should rate limit smart playlist creation', async () => {
    const LIMIT = 10;
    const body = { name: 'test', criteria: '{}' };

    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app).post('/api/smart-playlists').send(body);
      expect(res.status).toBe(200);
    }

    const blockedRes = await request(app)
      .post('/api/smart-playlists')
      .send(body);
    expect(blockedRes.status).toBe(429);
  });

  it('should rate limit media rating', async () => {
    const LIMIT = 10;
    const body = { filePath: '/tmp/test.mp4', rating: 5 };

    for (let i = 0; i < LIMIT; i++) {
      const res = await request(app).post('/api/media/rate').send(body);
      expect(res.status).toBe(200);
    }

    const blockedRes = await request(app).post('/api/media/rate').send(body);
    expect(blockedRes.status).toBe(429);
  });

  it('should NOT rate limit read-only endpoints', async () => {
    // Send 15 requests to a read endpoint (more than the write limit of 10)
    for (let i = 0; i < 15; i++) {
      const res = await request(app).get('/api/albums');
      expect(res.status).not.toBe(429);
    }
  });
});
