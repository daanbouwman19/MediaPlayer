import { describe, it, expect, afterEach, vi, beforeEach, Mock } from 'vitest';
import http from 'http';
import fs from 'fs';
import path from 'path';
import EventEmitter from 'events';
import {
  startLocalServer,
  stopLocalServer,
  getServerPort,
  getMimeType,
} from '../../src/main/local-server';
import { clearAuthCache } from '../../src/core/auth/security';
import { createTestMediaService } from '../utils/test-factory';

// Mock the database module
vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn(),
  getPendingTranscodeJobs: vi.fn().mockResolvedValue([]),
}));

import { getMediaDirectories } from '../../src/core/database/database';

// Helper to promisify callback-based functions
const startServer = () => {
  const { service } = createTestMediaService();
  return new Promise<void>((resolve) => {
    startLocalServer('/tmp', service, () => resolve());
  });
};

const stopServer = () =>
  new Promise<void>((resolve) => {
    stopLocalServer(() => resolve());
  });

describe('Local Server', () => {
  beforeEach(() => {
    clearAuthCache();
    // Mock getMediaDirectories to return the process's current working directory
    // This allows tests to serve files from the test environment
    (getMediaDirectories as unknown as Mock).mockResolvedValue([
      { path: process.cwd() },
    ]);
  });

  afterEach(async () => {
    // Clean up server after each test
    if (getServerPort() > 0) {
      await stopServer();
    }
    vi.restoreAllMocks();
  });

  describe('getMimeType', () => {
    it('should return correct MIME type for images', () => {
      expect(getMimeType('test.png')).toBe('image/png');
      expect(getMimeType('test.jpg')).toBe('image/jpeg');
      expect(getMimeType('test.jpeg')).toBe('image/jpeg');
    });

    it('should return correct MIME type for videos', () => {
      expect(getMimeType('test.mp4')).toBe('video/mp4');
      expect(getMimeType('test.webm')).toBe('video/webm');
      expect(getMimeType('test.mov')).toBe('video/quicktime');
    });

    it('should return correct MIME type for additional video formats', () => {
      expect(getMimeType('test.avi')).toBe('video/x-msvideo');
      expect(getMimeType('test.mkv')).toBe('video/x-matroska');
      expect(getMimeType('test.ogg')).toBe('video/ogg');
    });

    it('should return default MIME type for unknown extensions', () => {
      expect(getMimeType('test.txt')).toBe('application/octet-stream');
      expect(getMimeType('test.xyz')).toBe('application/octet-stream'); // Truly unknown extension
    });
  });

  describe('startLocalServer', () => {
    it('should start server and set port', async () => {
      await startServer();
      expect(getServerPort()).toBeGreaterThan(0);
    });

    it('should handle starting when server already running', async () => {
      await startServer();
      const port1 = getServerPort();
      await startServer();
      const port2 = getServerPort();
      expect(port1).toBe(port2);
    });

    it('should ignore start request if server is already running (callback)', async () => {
      const { service } = createTestMediaService();
      await new Promise<void>((resolve) => {
        startLocalServer('/tmp', service, () => {
          const originalPort = getServerPort();
          const consoleSpy = vi
            .spyOn(console, 'warn')
            .mockImplementation(() => {});

          startLocalServer('/tmp', service, () => {
            expect(getServerPort()).toBe(originalPort);
            expect(consoleSpy).toHaveBeenCalledWith(
              expect.stringContaining('Server already started'),
            );
            consoleSpy.mockRestore();
            resolve();
          });
        });
      });
    });

    it('should handle start without callback when running', async () => {
      await startServer();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { service } = createTestMediaService();
      startLocalServer('/tmp', service); // No callback
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('stopLocalServer', () => {
    it('should stop the server', async () => {
      await startServer();
      expect(getServerPort()).toBeGreaterThan(0);

      await stopServer();
      expect(getServerPort()).toBe(0);
    });

    it('should handle stopping when server not running', async () => {
      await stopServer();
      expect(getServerPort()).toBe(0);
    });

    it('should handle stop without callback', async () => {
      await startServer();
      stopLocalServer(); // No callback
      // Wait for server to stop
      await vi.waitUntil(() => getServerPort() === 0);
      expect(getServerPort()).toBe(0);
    });

    it('should handle stop callback if server is already stopped', async () => {
      await new Promise<void>((resolve) => {
        stopLocalServer(() => {
          // Server is stopped
          stopLocalServer(() => {
            // Callback called immediately
            resolve();
          });
        });
      });
    });
  });

  describe('getServerPort', () => {
    it('should return 0 when server not started', () => {
      expect(getServerPort()).toBe(0);
    });

    it('should return port when server is running', async () => {
      await startServer();
      const port = getServerPort();
      expect(port).toBeGreaterThan(0);
    });
  });

  describe('HTTP Request Handling', () => {
    let testFilePath: any;

    afterEach(() => {
      // Clean up test file
      if (testFilePath && fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    it('should serve a file successfully', async () => {
      // Create a test file
      const testDir = path.join(process.cwd(), 'tests', 'temp');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      testFilePath = path.join(testDir, 'test-file.txt');
      const testContent = 'Hello, World!';
      fs.writeFileSync(testFilePath, testContent);

      await startServer();
      const port = getServerPort();

      // Make HTTP request

      const response: any = await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/${encodeURIComponent(testFilePath)}`,
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({
                statusCode: res.statusCode,
                data,
                headers: res.headers,
              }),
            );
          },
        );
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(200);
      expect(response.data).toBe(testContent);
      expect(response.headers['content-type']).toContain('text/plain');
    });

    it('should return 403 for non-existent file (security)', async () => {
      await startServer();
      const port = getServerPort();

      const response: any = await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/nonexistent-file.txt`,
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
          },
        );
        req.on('error', reject);
      });

      // Expect 403 to prevent file enumeration
      expect(response.statusCode).toBe(403);
      expect(response.data).toBe('Access denied.');
    });

    it('should handle range requests', async () => {
      // Create a test file
      const testDir = path.join(process.cwd(), 'tests', 'temp');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      testFilePath = path.join(testDir, 'test-range.txt');
      const testContent = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      fs.writeFileSync(testFilePath, testContent);

      await startServer();
      const port = getServerPort();

      // Make range request

      const response: any = await new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port,
          path: `/${encodeURIComponent(testFilePath)}`,
          headers: { Range: 'bytes=0-9' },
        };

        const req = http.get(options, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () =>
            resolve({ statusCode: res.statusCode, data, headers: res.headers }),
          );
        });
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(206);
      expect(response.data).toBe('ABCDEFGHIJ');
      expect(response.headers['content-range']).toContain('bytes 0-9/26');
    });

    it('should return 416 for invalid range', async () => {
      // Create a test file
      const testDir = path.join(process.cwd(), 'tests', 'temp');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      testFilePath = path.join(testDir, 'test-invalid-range.txt');
      fs.writeFileSync(testFilePath, 'Content');

      await startServer();
      const port = getServerPort();

      // Make invalid range request

      const response: any = await new Promise((resolve, reject) => {
        const options = {
          hostname: '127.0.0.1',
          port,
          path: `/${encodeURIComponent(testFilePath)}`,
          headers: { Range: 'bytes=1000-2000' },
        };

        const req = http.get(options, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ statusCode: res.statusCode, data }));
        });
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(416);
      // Express might send different body, so checking status code is sufficient verification of range handling compliance.
    });

    it('should serve video files with correct MIME type', async () => {
      // Create a test video file
      const testDir = path.join(process.cwd(), 'tests', 'temp');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      testFilePath = path.join(testDir, 'test-video.mp4');
      fs.writeFileSync(testFilePath, 'fake video content');

      await startServer();
      const port = getServerPort();

      const response: any = await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/${encodeURIComponent(testFilePath)}`,
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () =>
              resolve({ statusCode: res.statusCode, headers: res.headers }),
            );
          },
        );
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toBe('video/mp4');
      expect(response.headers['accept-ranges']).toBe('bytes');
    });
  });

  describe('Security - Path Validation', () => {
    let testFilePath: any;

    afterEach(() => {
      // Clean up test file after each test
      if (testFilePath && fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    it('should return 403 for files outside allowed directories', async () => {
      // Mock getMediaDirectories to return a specific directory
      const allowedDir = path.join(process.cwd(), 'tests', 'temp');
      (getMediaDirectories as unknown as Mock).mockResolvedValue([
        { path: allowedDir },
      ]);

      // Create a file outside the allowed directory
      const outsideDir = path.join(process.cwd(), 'tests', 'forbidden');
      if (!fs.existsSync(outsideDir)) {
        fs.mkdirSync(outsideDir, { recursive: true });
      }
      testFilePath = path.join(outsideDir, 'forbidden-file.txt');
      fs.writeFileSync(testFilePath, 'You should not see this');

      await startServer();
      const port = getServerPort();

      const response: any = await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/${encodeURIComponent(testFilePath)}`,
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
          },
        );
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(403);
      expect(response.data).toBe('Access denied.');

      // Cleanup directory (file cleanup handled by afterEach)
      if (fs.existsSync(outsideDir)) {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it('should return 500 when database error occurs during path validation', async () => {
      // Mock getMediaDirectories to throw an error
      (getMediaDirectories as unknown as Mock).mockRejectedValue(
        new Error('Database error'),
      );

      const testDir = path.join(process.cwd(), 'tests', 'temp');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      testFilePath = path.join(testDir, 'test-file.txt');
      fs.writeFileSync(testFilePath, 'Test content');

      await startServer();
      const port = getServerPort();

      const response: any = await new Promise((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${port}/${encodeURIComponent(testFilePath)}`,
          (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ statusCode: res.statusCode, data }));
          },
        );
        req.on('error', reject);
      });

      expect(response.statusCode).toBe(500);
      expect(response.data).toBe('Internal server error.');

      // Restore mock for subsequent tests
      (getMediaDirectories as unknown as Mock).mockResolvedValue([
        { path: process.cwd() },
      ]);
    });
  });

  describe('Server Error Handling', () => {
    it('should handle server listen errors gracefully', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const mockServer: any = new EventEmitter();
      mockServer.on('error', () => {}); // Prevent unhandled error crash

      mockServer.listen = vi.fn((_port: any, _host: any, cb: any) => {
        // Defer error emission to ensure the '.on('error',...)' handler is attached.
        process.nextTick(() =>
          mockServer.emit('error', new Error('EADDRINUSE test error')),
        );
        if (cb) cb();
      });
      mockServer.address = () => ({ port: 12345 });
      mockServer.unref = vi.fn();
      mockServer.close = vi.fn((cb) => cb && cb()); // For afterEach cleanup

      vi.spyOn(http, 'createServer').mockReturnValue(mockServer);

      await startServer();

      // Give the event loop a chance to process the error
      await new Promise(setImmediate);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[local-server.js] Server Error:',
        expect.objectContaining({ message: 'EADDRINUSE test error' }),
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('stopLocalServer', () => {
    it('should handle callback parameter correctly', async () => {
      await startServer();
      let callbackCalled = false;

      await new Promise<void>((resolve) => {
        stopLocalServer(() => {
          callbackCalled = true;
          resolve();
        });
      });

      expect(callbackCalled).toBe(true);
      expect(getServerPort()).toBe(0);
    });

    it('should log an error if closing fails', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const closeError = new Error('Server close failed');

      const mockServer: any = new EventEmitter();

      mockServer.listen = vi.fn(
        (_port: number, _host: string, cb: () => void) => cb && cb(),
      );
      mockServer.address = () => ({ port: 12345 });
      mockServer.unref = vi.fn();
      mockServer.close = vi.fn((cb) => cb && cb(closeError));

      vi.spyOn(http, 'createServer').mockReturnValue(mockServer);

      const { service } = createTestMediaService();
      await new Promise<void>((resolve) => {
        startLocalServer('/tmp', service, () => resolve());
      });
      await stopServer();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[local-server.js] Error stopping server:',
        closeError,
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
