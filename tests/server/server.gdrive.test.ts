import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// Mock dependencies
const mockFs = {
  stat: vi.fn(),
  access: vi.fn(),
  mkdir: vi.fn(),
};
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('fs/promises', () => ({ default: mockFs }));

// Mock core modules
vi.mock('../../src/core/database');
vi.mock('../../src/core/media-service');
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

vi.mock('../../src/core/media-handler', () => ({
  MediaHandler: MockMediaHandler,
  serveMetadata: vi.fn(),
  serveTranscodedStream: vi.fn(),
  serveRawStream: vi.fn(),
  serveThumbnail: vi.fn(),
  serveStaticFile: vi.fn(),
}));

// Mock main modules used by server routes
vi.mock('../../src/main/google-auth', () => ({
  generateAuthUrl: vi.fn().mockReturnValue('http://mock.auth.url'),
  authenticateWithCode: vi.fn(),
}));

vi.mock('../../src/main/google-drive-service', () => ({
  getDriveClient: vi.fn().mockResolvedValue({
    files: {
      get: vi.fn().mockResolvedValue({
        data: { id: 'gdrive_id', name: 'Drive Folder' },
      }),
    },
  }),
}));

// Import app creator - we need to dynamic import to ensure mocks apply
// But server.ts is an ESM module that might execute top-level code.
// Ideally we import the createApp function.
// Let's rely on dynamic import in tests.

describe('Server Google Drive Routes', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createApp } = await import('../../src/server/server');
    const { createTestMediaService } = await import('../utils/test-factory');
    const { service } = createTestMediaService();
    app = await createApp(service);
  });

  it('GET /api/auth/google-drive/start returns URL', async () => {
    const res = await request(app).get('/api/auth/google-drive/start');
    expect(res.status).toBe(200);
    expect(res.text).toBe('http://mock.auth.url');
  });

  it('POST /api/auth/google-drive/code accepts code', async () => {
    const res = await request(app)
      .post('/api/auth/google-drive/code')
      .send({ code: 'valid-code' });
    expect(res.status).toBe(200);
  });

  it('POST /api/auth/google-drive/code returns 400 if missing code', async () => {
    const res = await request(app).post('/api/auth/google-drive/code').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/sources/google-drive adds source', async () => {
    const res = await request(app)
      .post('/api/sources/google-drive')
      .send({ folderId: 'folder123' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, name: 'Drive Folder' });
  });

  it('POST /api/sources/google-drive returns 400 if missing id', async () => {
    const res = await request(app).post('/api/sources/google-drive').send({});
    expect(res.status).toBe(400);
  });
});
