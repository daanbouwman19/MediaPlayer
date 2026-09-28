import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import * as systemRoutes from '../../../src/server/routes/system.routes';
import * as security from '../../../src/core/auth/security';
import * as database from '../../../src/core/database/database';
import * as fileSystem from '../../../src/core/media/file-system';
import { AppError } from '../../../src/core/media/errors';
import { ALL_SUPPORTED_EXTENSIONS } from '../../../src/core/media/constants';

// Mocks
vi.mock('../../../src/core/database/database');
vi.mock('../../../src/core/media/file-system');
vi.mock('../../../src/core/auth/security');
vi.mock('../../../src/infrastructure/google-drive-service');

// Mock Limiters
const mockLimiters = {
  readLimiter: (_req: any, _res: any, _next: any) => {
    _next();
  },
  writeLimiter: (_req: any, _res: any, _next: any) => {
    _next();
  },
  fileLimiter: (_req: any, _res: any, _next: any) => {
    _next();
  },
  streamLimiter: (_req: any, _res: any, _next: any) => {
    _next();
  },
};

describe('System Routes Coverage', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(bodyParser.json());
    app.use(systemRoutes.createSystemRoutes(mockLimiters as any));

    // Error handler
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    });

    // Default mocks
    vi.mocked(security.validateInput).mockReturnValue(null);
    vi.mocked(fileSystem.resolveMediaSourceDirectory).mockImplementation(
      async (p: string) => p,
    );
    vi.mocked(database.getMediaDirectories).mockResolvedValue([]);
  });

  describe('POST /api/directories', () => {
    it('rejects a folder nested inside an active source with 409', async () => {
      vi.mocked(database.getMediaDirectories).mockResolvedValue([
        { id: '1', path: '/media', type: 'local', name: 'm', isActive: true },
      ]);

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/media/sub' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('is inside the media source "/media"');
      expect(database.addMediaDirectory).not.toHaveBeenCalled();
    });

    it('rejects a folder that contains an active source with 409', async () => {
      vi.mocked(database.getMediaDirectories).mockResolvedValue([
        {
          id: '1',
          path: '/media/sub',
          type: 'local',
          name: 's',
          isActive: true,
        },
      ]);

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/media' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('contains the media source');
      expect(database.addMediaDirectory).not.toHaveBeenCalled();
    });

    it('should block non-absolute paths', async () => {
      const res = await request(app)
        .post('/api/directories')
        .send({ path: 'relative/path' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid path');
    });

    it('should normalize paths with ".." segments and allow if safe', async () => {
      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/abs/path/../forbidden' });

      expect(res.status).toBe(200);
    });

    // The checks themselves (sensitive, missing, outside the allowed roots)
    // run against the real file-system module in system.routes.fs.test.ts.
    it('should return 403 when the folder is rejected as sensitive', async () => {
      vi.mocked(fileSystem.resolveMediaSourceDirectory).mockRejectedValueOnce(
        new AppError(403, 'Access restricted for sensitive system directories'),
      );

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/etc/passwd' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access restricted');
      expect(database.addMediaDirectory).not.toHaveBeenCalled();
    });

    it('should return 400 when the folder does not exist', async () => {
      vi.mocked(fileSystem.resolveMediaSourceDirectory).mockRejectedValueOnce(
        new AppError(400, 'Directory does not exist'),
      );

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/non/existent' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Directory does not exist');
    });

    it('should store the resolved path', async () => {
      vi.mocked(fileSystem.resolveMediaSourceDirectory).mockResolvedValueOnce(
        '/real/target',
      );

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/symlink/to/target' });

      expect(res.status).toBe(200);
      expect(database.addMediaDirectory).toHaveBeenCalledWith('/real/target');
    });
  });

  describe('Validation Edge Cases', () => {
    it('POST /api/smart-playlists missing arguments', async () => {
      const res = await request(app).post('/api/smart-playlists').send({});
      expect(res.status).toBe(400);
    });

    it('PUT /api/smart-playlists/:id invalid id', async () => {
      const res = await request(app)
        .put('/api/smart-playlists/abc')
        .send({ name: 'n', criteria: 'c' });
      expect(res.status).toBe(400);
    });

    it('DELETE /api/smart-playlists/:id invalid id', async () => {
      const res = await request(app).delete('/api/smart-playlists/abc');
      expect(res.status).toBe(400);
    });

    it('POST /api/smart-playlists/execute missing criteria', async () => {
      const res = await request(app)
        .post('/api/smart-playlists/execute')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid criteria');
    });

    it('POST /api/smart-playlists/execute non-string criteria', async () => {
      const res = await request(app)
        .post('/api/smart-playlists/execute')
        .send({ criteria: { minRating: 4 } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid criteria');
    });

    it('POST /api/smart-playlists/execute over-length criteria', async () => {
      const res = await request(app)
        .post('/api/smart-playlists/execute')
        .send({ criteria: 'x'.repeat(10001) });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid criteria');
    });

    it('POST /api/smart-playlists/execute returns executeSmartPlaylist output', async () => {
      const items = [{ id: 1, path: '/a.mp4' }] as any;
      vi.mocked(database.executeSmartPlaylist).mockResolvedValue(items);
      const res = await request(app)
        .post('/api/smart-playlists/execute')
        .send({ criteria: '{"minRating":4}' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(items);
      expect(database.executeSmartPlaylist).toHaveBeenCalledWith(
        '{"minRating":4}',
      );
    });

    it('POST /api/directories missing path', async () => {
      const res = await request(app).post('/api/directories').send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/directories invalid path type', async () => {
      const res = await request(app)
        .post('/api/directories')
        .send({ path: 123 });
      expect(res.status).toBe(400);
    });

    it('POST /api/directories security validation fail', async () => {
      vi.mocked(security.validateInput).mockReturnValue({
        isAllowed: false,
        message: 'Bad Input',
      });
      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/valid/but/bad/chars' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Bad Input');
    });
  });

  describe('File System Routes', () => {
    it('GET /api/fs/ls missing path', async () => {
      const res = await request(app).get('/api/fs/ls');
      expect(res.status).toBe(400);
    });

    it('GET /api/fs/ls security validation fail', async () => {
      vi.mocked(security.validateInput).mockReturnValue({
        isAllowed: false,
        message: 'Bad',
      });
      const res = await request(app).get('/api/fs/ls?path=bad');
      expect(res.status).toBe(400);
    });

    it('GET /api/fs/ls restricted path', async () => {
      vi.mocked(security.validateInput).mockReturnValue(null);
      vi.mocked(fileSystem.listDirectory).mockRejectedValueOnce(
        new AppError(403, 'Access denied'),
      );

      const res = await request(app).get('/api/fs/ls?path=/root');
      expect(res.status).toBe(403);
    });

    it('GET /api/fs/parent missing path', async () => {
      const res = await request(app).get('/api/fs/parent');
      expect(res.status).toBe(400);
    });

    it('GET /api/fs/parent root path', async () => {
      vi.mocked(fileSystem.getParentDirectory).mockResolvedValueOnce(null);
      const res = await request(app).get('/api/fs/parent?path=/');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ parent: null });
    });
  });

  describe('Google Drive Routes', () => {
    it('POST /api/sources/google-drive missing folderId', async () => {
      const res = await request(app).post('/api/sources/google-drive').send({});
      expect(res.status).toBe(400);
    });

    it('GET /api/drive/parent missing folderId', async () => {
      const res = await request(app).get('/api/drive/parent');
      expect(res.status).toBe(400);
    });
  });

  describe('Directory State', () => {
    it('PUT /api/directories/active missing path', async () => {
      const res = await request(app)
        .put('/api/directories/active')
        .send({ isActive: true });
      expect(res.status).toBe(400);
    });
  });

  describe('Additional Gap Fill', () => {
    it('GET /api/config/extensions: returns correct structure', async () => {
      const res = await request(app).get('/api/config/extensions');
      expect(res.status).toBe(200);
      expect(res.body.all).toEqual(ALL_SUPPORTED_EXTENSIONS);
    });

    it('GET /api/fs/ls: handles invalid path type (array/object passed as query)', async () => {
      const res = await request(app).get('/api/fs/ls?path[]=foo');
      expect(res.status).toBe(400);
    });

    it('GET /api/fs/parent: handles invalid path type', async () => {
      const res = await request(app).get('/api/fs/parent?path[]=foo');
      expect(res.status).toBe(400);
    });

    it('GET /api/fs/parent: handles validation failure', async () => {
      vi.mocked(security.validateInput).mockReturnValue({
        isAllowed: false,
        message: 'Invalid',
      } as any);
      const res = await request(app).get('/api/fs/parent?path=/foo');
      expect(res.status).toBe(400);
    });
  });
});
