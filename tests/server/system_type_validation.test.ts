import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/server';

// Mock dependencies
vi.mock('../../src/core/database/database');
vi.mock('../../src/core/media/media-service');
vi.mock('../../src/core/media/file-system');
vi.mock('../../src/core/media/media-handler', () => ({
  MediaHandler: class {},
}));
vi.mock('../../src/main/google-auth');
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    realpath: vi.fn((p) => Promise.resolve(p)),
    access: vi.fn(() => Promise.resolve()),
    readFile: vi.fn(() => Promise.resolve('')),
  },
}));

describe('System Routes Type Validation', () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createTestMediaService } = await import('../utils/test-factory');
    const { service } = createTestMediaService();
    app = await createApp(service);
  });

  describe('POST /api/directories', () => {
    it('should return 400 for number as path', async () => {
      const payload = { path: 12345 };
      const response = await request(app)
        .post('/api/directories')
        .send(payload);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid path');
    });

    it('should return 400 for object as path', async () => {
      const payload = { path: { bad: 'object' } };
      const response = await request(app)
        .post('/api/directories')
        .send(payload);
      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid path');
    });
  });

  describe('DELETE /api/directories', () => {
    it('should return 400 for number as path', async () => {
      const payload = { path: 12345 };
      const response = await request(app)
        .delete('/api/directories')
        .send(payload);
      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/directories/active', () => {
    it('should return 400 for number as path', async () => {
      const payload = { path: 12345, isActive: true };
      const response = await request(app)
        .put('/api/directories/active')
        .send(payload);
      expect(response.status).toBe(400);
    });
  });

  describe('Smart Playlists Validation', () => {
    it('POST /api/smart-playlists should return 400 for missing criteria', async () => {
      const response = await request(app)
        .post('/api/smart-playlists')
        .send({ name: 'My List' });
      expect(response.status).toBe(400);
    });

    it('PUT /api/smart-playlists/:id should return 400 for invalid id', async () => {
      const response = await request(app)
        .put('/api/smart-playlists/abc')
        .send({ name: 'Updated List', criteria: 'c' });
      expect(response.status).toBe(400);
    });

    it('DELETE /api/smart-playlists/:id should return 400 for invalid id', async () => {
      const response = await request(app).delete('/api/smart-playlists/abc');
      expect(response.status).toBe(400);
    });
  });

  describe('File System Validation', () => {
    it('GET /api/fs/ls should return 400 for missing path', async () => {
      const response = await request(app).get('/api/fs/ls');
      expect(response.status).toBe(400);
    });

    it('GET /api/fs/parent should return 400 for missing path', async () => {
      const response = await request(app).get('/api/fs/parent');
      expect(response.status).toBe(400);
    });
  });

  describe('Google Drive Validation', () => {
    it('POST /api/sources/google-drive should return 400 for missing folderId', async () => {
      const response = await request(app)
        .post('/api/sources/google-drive')
        .send({});
      expect(response.status).toBe(400);
    });

    it('GET /api/drive/parent should return 400 for missing folderId', async () => {
      const response = await request(app).get('/api/drive/parent');
      expect(response.status).toBe(400);
    });
  });
});
