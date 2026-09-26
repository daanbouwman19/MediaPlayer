// @vitest-environment node
import { describe, it, expect } from 'vite-plus/test';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import os from 'os';

describe('Thumbnail Generation Integration', () => {
  it(
    'should generate a thumbnail using valid ffmpeg args',
    { timeout: 60000 },
    async () => {
      const tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'mediaplayer-repro-'),
      );
      const videoFile = path.join(tempDir, 'test_video.mp4');
      const cacheFile = path.join(tempDir, 'thumbnail.jpg');

      // 1. Generate a 1-second dummy video (smaller and shorter for speed)
      const createArgs = [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=160x120:rate=10',
        videoFile,
      ];

      const createChild = spawn(ffmpegPath!, createArgs);
      await new Promise<void>((resolve, reject) => {
        createChild.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Failed to create video: code ${code}`));
        });
      });

      expect(fs.existsSync(videoFile)).toBe(true);

      // 2. Attempt to generate thumbnail
      const generateArgs = [
        '-y',
        '-ss',
        '0.5',
        '-i',
        videoFile,
        '-frames:v',
        '1',
        '-q:v',
        '5',
        '-update',
        '1',
        cacheFile,
      ];

      const child = spawn(ffmpegPath!, generateArgs);
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));

      const code = await new Promise<number | null>((resolve) => {
        child.on('close', (code) => resolve(code));
        child.on('error', (err) => {
          console.error('Spawn error:', err);
          resolve(null);
        });
      });

      if (code !== 0) {
        console.error('FFmpeg Stderr:', stderr);
      }

      expect(code).toBe(0);
      const exists = fs.existsSync(cacheFile);
      expect(exists).toBe(true);

      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  );
});
