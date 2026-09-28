// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vite-plus/test';
import express from 'express';
import request from 'supertest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Authorize the fake video path; everything else is real.
vi.mock('../../src/core/auth/access-validator.ts', () => ({
  validateFileAccess: vi.fn(async (filePath: string) => ({
    success: true,
    path: filePath,
  })),
  handleAccessCheck: vi.fn(() => false),
}));

import {
  generateSessionId,
  serveHlsSegment,
} from '../../src/core/media/hls-handler.ts';
import { HlsManager } from '../../src/core/media/hls-manager.ts';

/**
 * Real Express 5 res.sendFile: send 1.x ignores dotfiles by default and 404s
 * any absolute path with a dot-directory in it, such as the Linux Electron
 * cache under ~/.config/<app>/hls (F05).
 */
describe('serveHlsSegment with a cache under a dot-directory', () => {
  const video = '/videos/movie.mkv';
  let root: string;
  let app: express.Express;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'hls-dotdir-'));
    const cacheDir = path.join(root, '.config', 'mediaplayer', 'hls');
    const sessionDir = path.join(cacheDir, await generateSessionId(video));
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, 'seg-000.ts'), 'segment-bytes');

    HlsManager.resetInstance();
    HlsManager.getInstance().setCacheDir(cacheDir);

    app = express();
    app.get('/api/hls/:segment', (req, res) => {
      void serveHlsSegment(req, res, video, req.params.segment);
    });
  });

  afterAll(async () => {
    HlsManager.resetInstance();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('serves an existing segment', async () => {
    const res = await request(app).get('/api/hls/seg-000.ts').buffer(true);

    expect(res.status).toBe(200);
    expect(Buffer.from(res.body as Buffer).toString()).toBe('segment-bytes');
  });

  it('still answers 404 for a missing segment', async () => {
    const res = await request(app).get('/api/hls/seg-001.ts');
    expect(res.status).toBe(404);
  });
});
