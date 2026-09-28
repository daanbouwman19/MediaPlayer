/**
 * The web-mode folder picker and "add source" routes against the real
 * file-system and security modules and the real error handler; only the disk
 * is an in-memory tree. (system.routes.coverage.test.ts mocks both modules.)
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
import express from 'express';
import os from 'os';
import path from 'path';
import { createSystemRoutes } from '../../../src/server/routes/system.routes';
import { errorHandler } from '../../../src/server/middleware/error-handler';
import * as database from '../../../src/core/database/database';
import { clearDrivesCache } from '../../../src/core/media/file-system';
import { virtualFs } from '../../utils/virtual-fs';

vi.mock(
  'fs/promises',
  async () => (await import('../../utils/virtual-fs')).virtualFsModule,
);

// Keep the real smart playlist validation; only the storage calls are fakes.
vi.mock('../../../src/core/database/database', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../src/core/database/database')
    >();
  return {
    ...actual,
    addMediaDirectory: vi.fn(),
    getMediaDirectories: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../../src/main/google-drive-service', () => ({
  getDriveClient: vi.fn(),
  getDriveParent: vi.fn(),
  listDriveDirectory: vi.fn(),
}));

const passThrough = (_req: any, _res: any, next: any) => next();
const limiters = {
  authLimiter: passThrough,
  writeLimiter: passThrough,
  telemetryLimiter: passThrough,
  readLimiter: passThrough,
  fileLimiter: passThrough,
  streamLimiter: passThrough,
} as any;

// The server's working directory is irrelevant to 'ROOT'; use one under a
// restricted root to prove the sentinel is never resolved against it.
const restrictedCwd =
  process.platform === 'win32'
    ? path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MediaPlayer')
    : '/opt/mediaplayer';

describe('web-mode filesystem routes (real checks)', () => {
  let app: express.Express;
  let root: string;
  let outside: string;

  beforeEach(() => {
    vi.clearAllMocks();
    virtualFs.reset();
    clearDrivesCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    root = virtualFs.addDir('/srv-media/library');
    virtualFs.addDir('/srv-media/library/Films');
    virtualFs.addDir('/srv-media/library/Library');
    virtualFs.addFile('/srv-media/library/.env');
    outside = virtualFs.addDir('/mnt-backup/finance');

    vi.stubEnv('MEDIAPLAYER_WEB_MODE', '1');
    vi.stubEnv('ALLOWED_FS_ROOTS', root);

    app = express();
    app.use(express.json());
    app.use(createSystemRoutes(limiters));
    app.use(errorHandler);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe('GET /api/fs/ls', () => {
    it('lists the allowed roots for ROOT (500 before)', async () => {
      vi.spyOn(process, 'cwd').mockReturnValue(restrictedCwd);

      const res = await request(app).get('/api/fs/ls?path=ROOT');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ name: root, path: root, isDirectory: true }]);
    });

    it('lists the home directory for ROOT when no roots are configured', async () => {
      vi.stubEnv('ALLOWED_FS_ROOTS', '');
      const home = virtualFs.addDir('/home-dir/alice');
      vi.spyOn(os, 'homedir').mockReturnValue(home);

      const res = await request(app).get('/api/fs/ls?path=ROOT');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([{ name: home, path: home, isDirectory: true }]);
    });

    it('lists an allowed root, hiding sensitive entries', async () => {
      const res = await request(app).get(
        `/api/fs/ls?path=${encodeURIComponent(root)}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.map((e: { name: string }) => e.name)).toEqual([
        'Films',
        'Library',
      ]);
    });

    it('answers 403 JSON for a directory outside the allowed roots', async () => {
      const res = await request(app).get(
        `/api/fs/ls?path=${encodeURIComponent(outside)}`,
      );

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: 'Access denied: path is outside allowed roots',
      });
    });
  });

  describe('GET /api/fs/parent', () => {
    it('returns null at an allowed root so the picker goes back to ROOT', async () => {
      const res = await request(app).get(
        `/api/fs/parent?path=${encodeURIComponent(root)}`,
      );
      expect(res.body).toEqual({ parent: null });
    });

    it('returns the parent below an allowed root', async () => {
      const res = await request(app).get(
        `/api/fs/parent?path=${encodeURIComponent(path.join(root, 'Films'))}`,
      );
      expect(res.body).toEqual({ parent: root });
    });
  });

  describe('POST /api/directories', () => {
    it('refuses a folder outside the allowed roots (was accepted)', async () => {
      const res = await request(app)
        .post('/api/directories')
        .send({ path: outside });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/outside allowed roots/);
      expect(database.addMediaDirectory).not.toHaveBeenCalled();
    });

    it('adds a folder inside the allowed roots', async () => {
      const films = path.join(root, 'Films');
      const res = await request(app)
        .post('/api/directories')
        .send({ path: films });

      expect(res.status).toBe(200);
      expect(res.body).toBe(films);
      expect(database.addMediaDirectory).toHaveBeenCalledWith(films);
    });

    it('adds a folder that is merely named Library (403 before)', async () => {
      const library = path.join(root, 'Library');
      const res = await request(app)
        .post('/api/directories')
        .send({ path: library });

      expect(res.status).toBe(200);
      expect(database.addMediaDirectory).toHaveBeenCalledWith(library);
    });

    it('answers 400 for a folder that does not exist', async () => {
      const res = await request(app)
        .post('/api/directories')
        .send({ path: path.join(root, 'missing') });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Directory does not exist' });
    });

    it('answers 400 for a file', async () => {
      const file = virtualFs.addFile(path.join(root, 'clip.mp4'));
      const res = await request(app)
        .post('/api/directories')
        .send({ path: file });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Not a directory' });
    });
  });

  describe('smart playlist validation through the real error handler', () => {
    it('answers 400 with the validation message (500 before)', async () => {
      const res = await request(app)
        .post('/api/smart-playlists')
        .send({ name: 'x'.repeat(101), criteria: '{}' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: 'Invalid playlist name (1-100 characters).',
      });
    });
  });
});
