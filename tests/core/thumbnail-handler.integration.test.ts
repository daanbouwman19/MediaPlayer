// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll } from 'vite-plus/test';
import express from 'express';
import request from 'supertest';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import {
  serveThumbnail,
  resetThumbnailState,
} from '../../src/core/media/thumbnail-handler';

// Only authorization is stubbed; Express, send, FFmpeg and the file system are real.
vi.mock('../../src/core/auth/access-validator', () => ({
  validateFileAccess: async (filePath: string) => ({
    success: true,
    path: filePath,
  }),
  handleAccessCheck: () => false,
}));

// A key of its own, so no master.key is created in the working directory.
vi.stubEnv('MASTER_KEY', 'cd'.repeat(32));

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

function ffmpeg(args: string[]) {
  const result = spawnSync(ffmpegPath!, ['-hide_banner', '-y', ...args]);
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.toString()}`);
  }
}

describe('Thumbnail serving (integration)', () => {
  let tmp: string;
  let cacheDir: string;
  let app: express.Express;
  const media: Record<string, string> = {};

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-int-'));
    // Linux Electron keeps userData under ~/.config: a dot-directory that
    // send (Express 5) refuses to serve from unless dotfiles are allowed.
    cacheDir = path.join(tmp, '.config', 'media-player', 'thumbnails');
    fs.mkdirSync(cacheDir, { recursive: true });

    media.image = path.join(tmp, 'photo.png');
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=1280x720',
      '-frames:v',
      '1',
      media.image,
    ]);
    media.shortClip = path.join(tmp, 'blink.mp4');
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=0.4:size=320x240:rate=10',
      '-pix_fmt',
      'yuv420p',
      media.shortClip,
    ]);
    media.video = path.join(tmp, 'clip.mp4');
    ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=3:size=1280x720:rate=10',
      '-pix_fmt',
      'yuv420p',
      media.video,
    ]);

    app = express();
    app.get('/thumbnail', async (req, res) => {
      await serveThumbnail(
        req,
        res,
        req.query.file as string,
        ffmpegPath!,
        cacheDir,
      );
    });
  }, 60_000);

  afterAll(() => {
    resetThumbnailState();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const getThumbnail = (file: string) =>
    request(app)
      .get('/thumbnail')
      .query({ file })
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it.each(['image', 'shortClip', 'video'])(
    'generates and serves a JPEG for %s from a dot-directory cache',
    async (kind) => {
      const first = await getThumbnail(media[kind]!);
      expect(first.status).toBe(200);
      expect(first.headers['content-type']).toBe('image/jpeg');
      expect((first.body as Buffer).subarray(0, 3)).toEqual(JPEG_MAGIC);

      // Served again from the cache inside the dot-directory.
      const cached = await getThumbnail(media[kind]!);
      expect(cached.status).toBe(200);
      expect(cached.body).toEqual(first.body);
    },
    60_000,
  );

  it('downscales large sources', async () => {
    const res = await getThumbnail(media.video!);
    const thumb = path.join(tmp, 'served.jpg');
    fs.writeFileSync(thumb, res.body as Buffer);
    const probe = spawnSync(ffmpegPath!, ['-hide_banner', '-i', thumb]);
    expect(probe.stderr.toString()).toMatch(/ 640x360/);
  });

  it('keeps only encrypted thumbnails on disk', () => {
    const entries = fs.readdirSync(cacheDir);
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      expect(name).toMatch(/\.jpg\.enc$/);
      const head = fs.readFileSync(path.join(cacheDir, name)).subarray(0, 3);
      expect(head).not.toEqual(JPEG_MAGIC);
    }
  });

  it('leaves no temp files behind', () => {
    const leftovers = fs
      .readdirSync(cacheDir)
      .filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});
