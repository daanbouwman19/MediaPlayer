import { describe, it, expect, afterEach, beforeEach, vi, Mock } from 'vitest';
import http from 'http';
import cp from 'child_process'; // Import for spying
import EventEmitter from 'events';

import {
  startLocalServer,
  stopLocalServer,
  getServerPort,
} from '../../src/main/local-server';
import { getMediaDirectories } from '../../src/core/database/database';
import { createTestMediaService } from '../utils/test-factory';

// Mock dependencies
vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn(),
  getPendingTranscodeJobs: vi.fn().mockResolvedValue([]),
}));

vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));

// REMOVED vi.mock('child_process')

describe('Local Server Encoding Bug', () => {
  let spawnSpy: any;

  beforeEach(() => {
    (getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: '/tmp' },
    ]);

    // Setup spy on child_process.spawn
    spawnSpy = vi.spyOn(cp, 'spawn').mockImplementation(() => {
      const proc: any = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdout = new EventEmitter();
      proc.stdout.pipe = vi.fn();
      proc.kill = vi.fn();
      proc.unref = vi.fn();

      // Trigger close asynchronously to simulate process finishing
      setTimeout(() => {
        proc.emit('close', 0);
      }, 10);

      return proc;
    });
  });

  afterEach(async () => {
    // Restore spy
    spawnSpy.mockRestore();

    await new Promise<void>((resolve) => stopLocalServer(resolve));
    vi.restoreAllMocks();
  });

  it('should handle file paths with percent characters without crashing', async () => {
    const { service } = createTestMediaService();
    await new Promise<void>((resolve) =>
      startLocalServer('/tmp', service, resolve),
    );
    const port = getServerPort();

    // A file name with a '%' that is NOT followed by two hex digits.
    // URL encoded: "/tmp/test%25file.mp4" -> server receives "/tmp/test%file.mp4"
    const badFileName = '/tmp/test%file.mp4';
    const encodedFileName = encodeURIComponent(badFileName);

    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        `http://localhost:${port}/video/metadata?file=${encodedFileName}`,
        (res) => {
          // If we receive a response, the server didn't crash.
          // We expect a valid status code.
          expect(res.statusCode).toBeDefined();
          resolve();
        },
      );

      req.on('error', (err) => {
        // If the server crashes, the client request usually errors with ECONNRESET or similar.
        reject(err);
      });
    });
  });
});
