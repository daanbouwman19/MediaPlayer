import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
import * as systemRoutes from '../../../src/server/routes/system.routes';
import * as security from '../../../src/core/auth/security';
import * as database from '../../../src/core/database/database';
import fs from 'fs/promises';
import { ALL_SUPPORTED_EXTENSIONS } from '../../../src/core/media/constants';

// Mocks
vi.mock('../../../src/core/database/database');
vi.mock('../../../src/core/media/file-system');
vi.mock('../../../src/core/auth/security');
vi.mock('../../../src/main/google-drive-service');
vi.mock('fs/promises', () => ({
  default: {
    realpath: vi.fn(),
  },
}));

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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({ error: err.message });
    });

    // Default mocks
    vi.mocked(security.validateInput).mockReturnValue(null);
    vi.mocked(security.isSensitiveDirectory).mockReturnValue(false);
    vi.mocked(fs.realpath).mockImplementation(async (p: any) => p as string);
  });

  describe('POST /api/directories', () => {
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

    it('should block sensitive raw paths', async () => {
      vi.mocked(security.isSensitiveDirectory).mockReturnValueOnce(true);

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/etc/passwd' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access restricted');
    });

    it('should handle realpath errors (directory not found)', async () => {
      vi.mocked(fs.realpath).mockRejectedValue(new Error('ENOENT'));

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/non/existent' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Directory does not exist');
    });

    it('should block sensitive resolved paths', async () => {
      // First check (raw) passes
      vi.mocked(security.isSensitiveDirectory).mockReturnValueOnce(false);
      // Second check (resolved) fails
      vi.mocked(security.isSensitiveDirectory).mockReturnValueOnce(true);

      const res = await request(app)
        .post('/api/directories')
        .send({ path: '/symlink/to/etc' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Access restricted');
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
      vi.mocked(security.isRestrictedPath).mockReturnValue(true);

      const res = await request(app).get('/api/fs/ls?path=/root');
      expect(res.status).toBe(403);
    });

    it('GET /api/fs/parent missing path', async () => {
      const res = await request(app).get('/api/fs/parent');
      expect(res.status).toBe(400);
    });

    it('GET /api/fs/parent root path', async () => {
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
