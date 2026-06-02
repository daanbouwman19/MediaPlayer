import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/server/server';
import * as database from '../../src/core/database/database';
import * as mediaHandler from '../../src/core/media/media-handler';
import * as fileSystem from '../../src/core/media/file-system'; // Added import
import * as security from '../../src/core/auth/security';
import * as mediaUtils from '../../src/core/media/media-utils';
import * as mimeTypes from '../../src/core/media/utils/mime-types';
import {
  MAX_API_BATCH_SIZE,
  MAX_PATH_LENGTH,
} from '../../src/core/media/constants';
import fs from 'fs/promises';
import {
  getDriveClient,
  listDriveDirectory,
  getDriveParent,
} from '../../src/main/google-drive-service';

// --- Global Mocks ---

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    stat: vi.fn(),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    access: vi.fn(),
    realpath: vi.fn((p) => Promise.resolve(p)),
    readdir: vi.fn(),
  },
  stat: vi.fn(),
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  access: vi.fn(),
  realpath: vi.fn((p) => Promise.resolve(p)),
  readdir: vi.fn(),
}));

// Mock fs (sync)
vi.mock('fs', () => {
  const createMockStream = () => {
    const listeners: Record<string, ((...args: any[]) => any)[]> = {};
    const stream: any = {
      on: (event: string, cb: (...args: any[]) => any) => {
        listeners[event] = listeners[event] || [];
        listeners[event].push(cb);
        return stream;
      },
      once: (event: string, cb: (...args: any[]) => any) => {
        const onceCb = (...args: any[]) => {
          cb(...args);
          stream.removeListener(event, onceCb);
        };
        return stream.on(event, onceCb);
      },
      emit: (event: string, ...args: any[]) => {
        if (listeners[event]) {
          listeners[event].forEach((cb) => cb(...args));
          return true;
        }
        return false;
      },
      removeListener: (event: string, cb: (...args: any[]) => any) => {
        if (listeners[event]) {
          listeners[event] = listeners[event].filter((l) => l !== cb);
        }
        return stream;
      },
      pipe: (dest: any) => {
        dest.end();
        return dest;
      },
      destroy: () => {},
    };
    return stream;
  };

  return {
    default: {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      unlinkSync: vi.fn(),
      createReadStream: vi.fn(createMockStream),
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    createReadStream: vi.fn(createMockStream),
  };
});

// Mock core modules
vi.mock('../../src/core/database/database');
vi.mock('../../src/core/media/file-system');
vi.mock('../../src/main/drive-cache-manager');
vi.mock('../../src/core/media/utils/mime-types');

// Mock security
vi.mock('../../src/core/auth/security', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/core/auth/security')>();
  return {
    ...actual,
    authorizeFilePath: vi.fn(),
    filterAuthorizedPaths: vi.fn(async (paths) => paths),
    isRestrictedPath: vi.fn().mockReturnValue(false),
    isSensitiveDirectory: vi.fn().mockReturnValue(false),
  };
});

// Mock rate-limiter (pass-through by default)
vi.mock('../../src/core/network/rate-limiter', () => ({
  createRateLimiter: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// Mock media-utils
vi.mock('../../src/core/media/media-utils', () => ({
  getThumbnailCachePath: vi.fn(),
  isDrivePath: vi.fn().mockReturnValue(false),
  normalizeFilePath: vi.fn((p) => p),
  getVlcPath: vi.fn(),
  getQueryParam: vi.fn((q, k) => q[k]),
}));

// Mock media-handler
const { MockMediaHandler, getLastMediaHandler } = vi.hoisted(() => {
  class MockMediaHandler {
    static lastInstance: MockMediaHandler | undefined;
    constructor() {
      MockMediaHandler.lastInstance = this;
    }
    serveMetadata = vi.fn((_req, res) => res.end());
    serveTranscodedStream = vi.fn((_req, res) => res.end());
    serveRawStream = vi.fn((_req, res) => res.end());
    serveThumbnail = vi.fn((_req, res) => res.end());
    serveStaticFile = vi.fn((_req, res) => res.end());
    serveHeatmap = vi.fn((_req, res) => res.end());
    serveHeatmapProgress = vi.fn((_req, res) => res.end());
    serveHlsMaster = vi.fn((_req, res) => res.end());
    serveHlsPlaylist = vi.fn((_req, res) => res.end());
    serveHlsSegment = vi.fn((_req, res) => res.end());
  }
  const getLastMediaHandler = () => MockMediaHandler.lastInstance;
  return { MockMediaHandler, getLastMediaHandler };
});

vi.mock('../../src/core/media/media-handler', () => ({
  MediaHandler: MockMediaHandler,
  serveMetadata: vi.fn((_req, res) => res.end()),
  serveTranscodedStream: vi.fn((_req, res) => res.end()),
  serveRawStream: vi.fn((_req, res) => res.end()),
  serveThumbnail: vi.fn((_req, res) => res.end()),
  serveStaticFile: vi.fn((_req, res) => res.end()),
  handleStreamRequest: vi.fn((_req, res) => res.end()),
  validateFileAccess: vi
    .fn()
    .mockResolvedValue({ success: true, path: '/resolved/path' }),
  generateFileUrl: vi.fn(),
  createMediaApp: vi.fn(),
  getVideoDuration: vi.fn(),
}));

// Mock google-auth
vi.mock('../../src/main/google-auth', () => ({
  generateAuthUrl: vi.fn(),
  authenticateWithCode: vi.fn(),
}));

// Mock google-drive-service
vi.mock('../../src/main/google-drive-service', () => ({
  getDriveClient: vi.fn(),
  listDriveDirectory: vi.fn(),
  getDriveParent: vi.fn(),
}));

// Mock media-source (for Transcode Concurrency test mainly)
vi.mock('../../src/core/media/media-source', async () => {
  const { EventEmitter } = await import('events');
  return {
    createMediaSource: vi.fn().mockReturnValue({
      getSize: vi.fn().mockResolvedValue(1000),
      getMimeType: vi.fn().mockResolvedValue('video/mp4'),
      getStream: vi.fn().mockResolvedValue({
        stream: Object.assign(new EventEmitter(), {
          pipe: vi.fn((dest) => {
            dest.write('raw data');
            dest.end();
            return dest;
          }),
          destroy: vi.fn(),
        }),
        length: 1000,
      }),
      getFFmpegInput: vi.fn().mockResolvedValue('test.mp4'),
    }),
  };
});

describe('Server Combined Tests', () => {
  let app: any;
  let service: any;

  beforeAll(async () => {
    const { createTestMediaService } = await import('../utils/test-factory');
    const result = createTestMediaService();
    service = result.service;
    app = await createApp(service);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Security Defaults
    vi.mocked(security.authorizeFilePath).mockResolvedValue({
      isAllowed: true,
      realPath: '/resolved/path',
    });
    vi.mocked(security.filterAuthorizedPaths).mockImplementation(
      async (paths) => paths,
    );
    vi.mocked(security.isRestrictedPath).mockReturnValue(false);
    vi.mocked(security.isSensitiveDirectory).mockReturnValue(false);

    // DB Defaults
    vi.mocked(database.getMediaViewCounts).mockResolvedValue({});
    vi.mocked(database.getMetadata).mockResolvedValue({});
    vi.mocked(database.getRecentlyPlayed).mockResolvedValue([]);
    vi.mocked(database.getMediaDirectories).mockResolvedValue([]);
    vi.mocked(database.addMediaDirectory).mockResolvedValue(undefined);
    vi.mocked(database.getSmartPlaylists).mockResolvedValue([]);
    vi.mocked(database.createSmartPlaylist).mockResolvedValue({
      id: 1,
    });
    vi.mocked(database.updateSmartPlaylist).mockResolvedValue(undefined);
    vi.mocked(database.deleteSmartPlaylist).mockResolvedValue(undefined);
    vi.mocked(database.removeMediaDirectory).mockResolvedValue(undefined);
    vi.mocked(database.setDirectoryActiveState).mockResolvedValue(undefined);
    vi.mocked(database.getAllMetadataAndStats).mockResolvedValue([]);
    vi.mocked(database.upsertMetadata).mockResolvedValue(undefined);

    // FS Defaults
    vi.mocked(fs.realpath).mockImplementation((p) =>
      Promise.resolve(p as string),
    );
    vi.mocked(fs.readdir).mockResolvedValue([] as any);

    // Media Utils Defaults
    vi.mocked(mediaUtils.getThumbnailCachePath).mockReturnValue(
      '/tmp/thumb.jpg',
    );
    vi.mocked(mediaUtils.isDrivePath).mockReturnValue(false);
    vi.mocked(mimeTypes.getMimeType).mockReturnValue('image/jpeg');
  });

  // --- Core Server Routes ---
  describe('Core Server Routes', () => {
    describe('GET /api/albums', () => {
      it('should return albums', async () => {
        const mockAlbums = [{ id: 1, name: 'Album 1' }];
        vi.spyOn(service, 'getAlbumsWithViewCounts').mockResolvedValue(
          mockAlbums as any,
        );
        const response = await request(app).get('/api/albums');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockAlbums);
      });

      it('should handle errors', async () => {
        vi.spyOn(service, 'getAlbumsWithViewCounts').mockRejectedValue(
          new Error('Test error'),
        );
        const response = await request(app).get('/api/albums');
        expect(response.status).toBe(500);
      });
    });

    describe('POST /api/albums/reindex', () => {
      it('should reindex and return albums', async () => {
        const mockAlbums = [{ id: 1, name: 'Album 1' }];
        vi.spyOn(service, 'getAlbumsWithViewCountsAfterScan').mockResolvedValue(
          mockAlbums as any,
        );
        const response = await request(app).post('/api/albums/reindex');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockAlbums);
      });
    });

    describe('POST /api/media/view', () => {
      it('should record media view', async () => {
        const filePath = '/path/to/file.jpg';
        const response = await request(app)
          .post('/api/media/view')
          .send({ filePath });
        expect(response.status).toBe(200);
        expect(database.recordMediaView).toHaveBeenCalledWith(filePath);
      });

      it('should return 400 if filePath is missing', async () => {
        const response = await request(app).post('/api/media/view').send({});
        expect(response.status).toBe(400);
      });

      it('should return 403 if access is denied', async () => {
        vi.mocked(security.authorizeFilePath).mockResolvedValue({
          isAllowed: false,
          message: 'Denied',
        });
        const response = await request(app)
          .post('/api/media/view')
          .send({ filePath: '/secret' });
        expect(response.status).toBe(403);
      });
    });

    describe('POST /api/media/views', () => {
      it('should return media view counts', async () => {
        const filePaths = ['/path/to/file.jpg'];
        const mockCounts = { '/path/to/file.jpg': 5 };
        vi.mocked(database.getMediaViewCounts).mockResolvedValue(mockCounts);
        const response = await request(app)
          .post('/api/media/views')
          .send({ filePaths });
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockCounts);
      });
    });

    describe('GET /api/directories', () => {
      it('should return directories', async () => {
        const mockDirs = ['/dir1', '/dir2'];
        vi.mocked(database.getMediaDirectories).mockResolvedValue(
          mockDirs as any,
        );
        const response = await request(app).get('/api/directories');
        expect(response.status).toBe(200);
        expect(response.body).toEqual(mockDirs);
      });
    });

    describe('POST /api/directories', () => {
      it('should add a directory', async () => {
        const dirPath = '/new/dir';
        vi.mocked(fs.realpath).mockResolvedValue(dirPath);
        const response = await request(app)
          .post('/api/directories')
          .send({ path: dirPath });
        expect(response.status).toBe(200);
        expect(database.addMediaDirectory).toHaveBeenCalledWith(dirPath);
      });
    });

    describe('DELETE /api/directories', () => {
      it('should remove a directory', async () => {
        const dirPath = '/dir/to/remove';
        const response = await request(app)
          .delete('/api/directories')
          .send({ path: dirPath });
        expect(response.status).toBe(200);
        expect(database.removeMediaDirectory).toHaveBeenCalledWith(dirPath);
      });
    });

    describe('PUT /api/directories/active', () => {
      it('should set directory active state', async () => {
        const dirPath = '/dir';
        const isActive = false;
        const response = await request(app)
          .put('/api/directories/active')
          .send({ path: dirPath, isActive });
        expect(response.status).toBe(200);
        expect(database.setDirectoryActiveState).toHaveBeenCalledWith(
          dirPath,
          isActive,
        );
      });
    });

    describe('Media Handler Routes', () => {
      it('GET /api/metadata should call serveMetadata', async () => {
        await request(app).get('/api/metadata').query({ file: 'test.mp4' });
        const handler = getLastMediaHandler();
        expect(handler).toBeTruthy();
        expect(handler!.serveMetadata).toHaveBeenCalled();
      });

      it('GET /api/thumbnail should call serveThumbnail', async () => {
        await request(app).get('/api/thumbnail').query({ file: 'test.jpg' });
        const handler = getLastMediaHandler();
        expect(handler).toBeTruthy();
        expect(handler!.serveThumbnail).toHaveBeenCalled();
      });
    });
  });

  // --- Transcode Concurrency (from server.transcode-limit.test.ts) ---
  describe('Server Transcode Concurrency', () => {
    let transcodeBarrier: Promise<void>;
    let releaseTranscode: () => void;
    let transcodeStartedCount = 0;

    beforeEach(async () => {
      transcodeStartedCount = 0;
      transcodeBarrier = new Promise((resolve) => {
        releaseTranscode = resolve;
      });

      // Override mock implementation for this test suite
      vi.mocked(mediaHandler.serveTranscodedStream).mockImplementation(
        async (_req, res) => {
          transcodeStartedCount++;
          res.write('chunk');
          await transcodeBarrier;
          res.end();
        },
      );

      // Ensure validation passes
      vi.mocked(mediaHandler.validateFileAccess).mockResolvedValue({
        success: true,
        path: 'test.mp4',
      });
    });

    it('should limit concurrent transcoding requests', async () => {
      // Overwrite the constant value by pushing LIMIT times.
      // Wait, constants cannot be simply overwritten.
      // In this test environment, the server is running against the default MAX_CONCURRENT_TRANSCODES.
      // We must fire requests to saturate the limit, then the next will fail.
      const LIMIT = 2;
      const pendingRequests: Promise<any>[] = [];

      for (let i = 0; i < LIMIT; i++) {
        const p = request(app)
          .get('/api/stream?file=test.mp4&transcode=true')
          .then((r) => r);
        pendingRequests.push(p);
      }

      await vi.waitUntil(() => transcodeStartedCount === LIMIT, {
        timeout: 5000,
      });

      const blockedRes = await request(app).get(
        '/api/stream?file=test.mp4&transcode=true',
      );
      expect(blockedRes.status).toBe(503);
      expect(blockedRes.text).toMatch(/server too busy/i);

      releaseTranscode();

      const results = await Promise.all(pendingRequests);
      results.forEach((res) => expect(res.status).toBe(200));

      const successRes = await request(app).get(
        '/api/stream?file=test.mp4&transcode=true',
      );
      expect(successRes.status).toBe(200);
    });
  });

  // --- Input Validation (from server.validation.test.ts) ---
  describe('Server Input Validation', () => {
    beforeEach(() => {
      // Validation middleware uses authorizeFilePath internally which does type checking sometimes
      // but mainly we want the schema validation middleware to fail before that.
      // The combined file already has authorizeFilePath mocked.

      // Re-mock authorizeFilePath to throw if not string, matching validation test expectation if applicable
      vi.mocked(security.authorizeFilePath).mockImplementation(
        async (p: any) => {
          if (typeof p !== 'string')
            throw new TypeError('Path must be a string');
          return { isAllowed: true, realPath: p };
        },
      );
    });

    const testCases = [
      {
        method: 'post',
        path: '/api/media/view',
        payload: {},
        description: 'fails when filePath is missing',
      },
      {
        method: 'post',
        path: '/api/media/view',
        payload: { filePath: 123 },
        description: 'fails when filePath is not a string',
      },
      {
        method: 'post',
        path: '/api/media/views',
        payload: {},
        description: 'fails when filePaths is missing',
      },
      {
        method: 'post',
        path: '/api/media/views',
        payload: { filePaths: 'string' },
        description: 'fails when filePaths is not an array',
      },
      {
        method: 'post',
        path: '/api/media/views',
        payload: { filePaths: Array(MAX_API_BATCH_SIZE + 1).fill('/path') },
        description: 'fails when batch size exceeds limit',
      },
      {
        method: 'post',
        path: '/api/media/rate',
        payload: {},
        description: 'fails when body is empty',
      },
      {
        method: 'post',
        path: '/api/media/rate',
        payload: { filePath: '/path' },
        description: 'fails when rating is missing',
      },
      {
        method: 'post',
        path: '/api/media/rate',
        payload: { rating: 5 },
        description: 'fails when filePath is missing',
      },
      {
        method: 'post',
        path: '/api/media/metadata',
        payload: {},
        description: 'fails when body is empty',
      },
      {
        method: 'get',
        path: '/api/stream',
        query: {},
        description: 'fails when file param is missing',
      },
      {
        method: 'get',
        path: '/api/metadata',
        query: {},
        description: 'fails when file param is missing',
      },
      {
        method: 'get',
        path: '/api/thumbnail',
        query: {},
        description: 'fails when file param is missing',
      },
    ];

    it.each(testCases)(
      '$method $path $description',
      async ({ method, path, payload, query }) => {
        let req = (request(app) as any)[method](path);
        if (payload) req = req.send(payload);
        if (query) req = req.query(query);
        const response = await req;
        expect(response.status).toBe(400);
      },
    );
  });

  // --- IDOR (from server.idor.test.ts) ---
  describe('Server Security: Metadata & Rating Protection (IDOR)', () => {
    it('should allow rating media if file is authorized', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: true,
        realPath: '/allowed/file.mp4',
      });
      const response = await request(app)
        .post('/api/media/rate')
        .send({ filePath: '/allowed/file.mp4', rating: 5 });
      expect(response.status).toBe(200);
      expect(database.setRating).toHaveBeenCalledWith('/allowed/file.mp4', 5);
    });

    it('should BLOCK rating media if file is unauthorized', async () => {
      vi.mocked(security.authorizeFilePath).mockResolvedValue({
        isAllowed: false,
        message: 'Access denied',
      });
      const response = await request(app)
        .post('/api/media/rate')
        .send({ filePath: '/secret.mp4', rating: 5 });
      expect(response.status).toBe(403);
      expect(database.setRating).not.toHaveBeenCalled();
    });
  });

  // --- Batch Limit (from server.batch-limit.test.ts) ---
  describe('Server Batch Limit', () => {
    it('should reject /api/media/views requests with more than limit', async () => {
      const hugeArray = new Array(MAX_API_BATCH_SIZE + 1).fill('/path');
      const res = await request(app)
        .post('/api/media/views')
        .send({ filePaths: hugeArray });
      expect(res.status).toBe(400);
    });
  });

  // --- Path Length (from path_length.test.ts) ---
  describe('Path Length Validation', () => {
    const longPath = '/' + 'a'.repeat(MAX_PATH_LENGTH + 100);
    const testCases = [
      { method: 'post', url: '/api/directories', payload: { path: longPath } },
      { method: 'get', url: '/api/fs/ls', query: { path: longPath } },
    ];

    it.each(testCases)(
      'should reject long paths for $url',
      async ({ method, url, payload, query }) => {
        const req = (request(app) as any)[method](url);
        if (payload) req.send(payload);
        if (query) req.query(query);
        const response = await req;
        expect(response.status).toBe(400);
      },
    );
  });

  // --- CSP ---
  describe('Server CSP', () => {
    it('should have Content-Security-Policy header', async () => {
      const response = await request(app).get('/api/config/extensions');
      expect(response.headers['content-security-policy']).toBeDefined();
    });
  });

  // --- Additional Coverage (Routes) ---
  describe('Additional Routes Coverage', () => {
    it('GET /api/fs/ls handles errors', async () => {
      vi.mocked(fileSystem.listDirectory).mockRejectedValue(
        new Error('FS Fail'),
      );
      const response = await request(app)
        .get('/api/fs/ls')
        .query({ path: '/' });
      expect(response.status).toBe(500);
    });
  });

  // --- Smart Playlists ---
  describe('Smart Playlists Routes', () => {
    it('GET /api/smart-playlists should return playlists', async () => {
      const mockPlaylists = [
        { id: 1, name: 'List', criteria: '[]', createdAt: '2023-01-01' },
      ];
      vi.mocked(database.getSmartPlaylists).mockResolvedValue(mockPlaylists);
      const res = await request(app).get('/api/smart-playlists');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockPlaylists);
    });

    it('POST /api/smart-playlists should create playlist', async () => {
      const payload = {
        name: 'My List',
        criteria: JSON.stringify({ rating: 5 }),
      };
      const res = await request(app).post('/api/smart-playlists').send(payload);
      expect(res.status).toBe(200);
      expect(database.createSmartPlaylist).toHaveBeenCalledWith(
        payload.name,
        payload.criteria,
      );
    });

    it('PUT /api/smart-playlists/:id should update playlist', async () => {
      const payload = { name: 'Updated', criteria: '[]' };
      const res = await request(app)
        .put('/api/smart-playlists/1')
        .send(payload);
      expect(res.status).toBe(200);
      expect(database.updateSmartPlaylist).toHaveBeenCalledWith(
        1,
        payload.name,
        payload.criteria,
      );
    });

    it('DELETE /api/smart-playlists/:id should delete playlist', async () => {
      const res = await request(app).delete('/api/smart-playlists/1');
      expect(res.status).toBe(200);
      expect(database.deleteSmartPlaylist).toHaveBeenCalledWith(1);
    });
  });

  // --- Drive Routes ---
  describe('Drive Routes', () => {
    beforeEach(() => {
      vi.mocked(getDriveClient).mockResolvedValue({
        files: {
          get: vi
            .fn()
            .mockResolvedValue({ data: { id: 'f1', name: 'Folder' } }),
        },
      } as any);
      vi.mocked(listDriveDirectory).mockResolvedValue([]);
      vi.mocked(getDriveParent).mockResolvedValue('parent-id');
    });

    it('POST /api/sources/google-drive should add source', async () => {
      const res = await request(app)
        .post('/api/sources/google-drive')
        .send({ folderId: 'xyz' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, name: 'Folder' });
      expect(database.addMediaDirectory).toHaveBeenCalledWith('gdrive://f1');
    });

    it('GET /api/drive/files should list files', async () => {
      const mockFiles = [
        { id: 'f1', name: 'File', path: '/p', isDirectory: false },
      ];
      vi.mocked(listDriveDirectory).mockResolvedValue(mockFiles);
      const res = await request(app)
        .get('/api/drive/files')
        .query({ folderId: 'root' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockFiles);
    });

    it('GET /api/drive/parent should return parent', async () => {
      const res = await request(app)
        .get('/api/drive/parent')
        .query({ folderId: 'child' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ parent: 'parent-id' });
    });
  });

  // --- Media Routes ---
  describe('Media Routes', () => {
    it('GET /api/media/all should return all items', async () => {
      const mockItems = [{ path: '/a.mp4' }];
      vi.mocked(database.getAllMetadataAndStats).mockResolvedValue(
        mockItems as any,
      );
      const res = await request(app).get('/api/media/all');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockItems);
    });

    it('GET /api/media/history should return history', async () => {
      const mockHistory = [{ path: '/b.mp4' }];
      vi.mocked(database.getRecentlyPlayed).mockResolvedValue(
        mockHistory as any,
      );
      const res = await request(app).get('/api/media/history');
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockHistory);
    });

    it('POST /api/media/metadata should upsert metadata', async () => {
      const payload = { filePath: '/file.mp4', metadata: { title: 'T' } };
      const res = await request(app).post('/api/media/metadata').send(payload);
      expect(res.status).toBe(200);
      expect(database.upsertMetadata).toHaveBeenCalledWith(
        payload.filePath,
        payload.metadata,
      );
    });

    it('POST /api/media/metadata/batch should return metadata', async () => {
      const payload = { filePaths: ['/a.mp4'] };
      const mockMeta = { '/a.mp4': {} };
      vi.mocked(database.getMetadata).mockResolvedValue(mockMeta);
      const res = await request(app)
        .post('/api/media/metadata/batch')
        .send(payload);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(mockMeta);
    });

    it('GET /api/hls/master.m3u8 should serve master', async () => {
      await request(app).get('/api/hls/master.m3u8').query({ file: 'v.mp4' });
      const handler = getLastMediaHandler();
      expect(handler!.serveHlsMaster).toHaveBeenCalled();
    });

    it('GET /api/hls/playlist.m3u8 should serve playlist', async () => {
      await request(app).get('/api/hls/playlist.m3u8').query({ file: 'v.mp4' });
      const handler = getLastMediaHandler();
      expect(handler!.serveHlsPlaylist).toHaveBeenCalled();
    });

    it('GET /api/hls/:segment should serve segment', async () => {
      await request(app).get('/api/hls/seg1.ts').query({ file: 'v.mp4' });
      const handler = getLastMediaHandler();
      expect(handler!.serveHlsSegment).toHaveBeenCalled();
    });

    it('GET /api/video/heatmap should serve heatmap', async () => {
      await request(app).get('/api/video/heatmap').query({ file: 'v.mp4' });
      const handler = getLastMediaHandler();
      expect(handler!.serveHeatmap).toHaveBeenCalled();
    });

    it('GET /api/video/heatmap/status should serve status', async () => {
      await request(app)
        .get('/api/video/heatmap/status')
        .query({ file: 'v.mp4' });
      const handler = getLastMediaHandler();
      expect(handler!.serveHeatmapProgress).toHaveBeenCalled();
    });
  });
});
