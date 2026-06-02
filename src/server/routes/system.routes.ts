/**
 * @file System routes (directories, filesystem, drive).
 */
import { Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { AppError } from '../../core/media/errors.ts';
import {
  ALL_SUPPORTED_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '../../core/media/constants.ts';
import {
  addMediaDirectory,
  createSmartPlaylist,
  deleteSmartPlaylist,
  getMediaDirectories,
  getSmartPlaylists,
  removeMediaDirectory,
  setDirectoryActiveState,
  updateSmartPlaylist,
} from '../../core/database/database.ts';
import { listDirectory } from '../../core/media/file-system.ts';
import {
  isRestrictedPath,
  isSensitiveDirectory,
  validateInput,
} from '../../core/auth/security.ts';
import { getQueryParam } from '../../core/network/http-utils.ts';
import {
  getDriveClient,
  getDriveParent,
  listDriveDirectory,
} from '../../main/google-drive-service.ts';
import type { RateLimiters } from '../middleware/rate-limiters.ts';
import { asyncHandler } from '../middleware/async-handler.ts';
import { createRateLimiter } from '../../core/network/rate-limiter.ts';
import {
  RATE_LIMIT_FS_READ_WINDOW_MS,
  RATE_LIMIT_FS_READ_MAX_REQUESTS,
} from '../../core/media/constants.ts';

function validateMediaDirectoryPath(dirPath: string): void {
  if (!path.isAbsolute(dirPath)) {
    throw new AppError(400, 'Invalid path');
  }

  const normalized = path.normalize(dirPath);
  const segments = normalized.split(path.sep).filter(Boolean);
  if (segments.includes('..')) {
    throw new AppError(400, 'Invalid path');
  }
}

export function createSystemRoutes(limiters: RateLimiters) {
  const router = Router();

  router.get(
    '/api/directories',
    limiters.readLimiter,
    asyncHandler(async (_req, res) => {
      const dirs = await getMediaDirectories();
      res.json(dirs);
    }),
  );

  router.get(
    '/api/smart-playlists',
    limiters.readLimiter,
    asyncHandler(async (_req, res) => {
      const playlists = await getSmartPlaylists();
      res.json(playlists);
    }),
  );

  router.post(
    '/api/smart-playlists',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const { name, criteria } = req.body;
      if (!name || !criteria) {
        throw new AppError(400, 'Missing name or criteria');
      }
      const result = await createSmartPlaylist(name, criteria);
      res.json(result);
    }),
  );

  router.put(
    '/api/smart-playlists/:id',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const id = parseInt((req.params.id as string) || '', 10);
      const { name, criteria } = req.body;
      if (isNaN(id) || !name || !criteria) {
        throw new AppError(400, 'Invalid arguments');
      }
      await updateSmartPlaylist(id, name, criteria);
      res.sendStatus(200);
    }),
  );

  router.delete(
    '/api/smart-playlists/:id',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const id = parseInt((req.params.id as string) || '', 10);
      if (isNaN(id)) {
        throw new AppError(400, 'Invalid id');
      }
      await deleteSmartPlaylist(id);
      res.sendStatus(200);
    }),
  );

  router.post(
    '/api/directories',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const { path: dirPath } = req.body;
      if (!dirPath) {
        throw new AppError(400, 'Missing path');
      }

      if (typeof dirPath !== 'string') {
        throw new AppError(400, 'Invalid path');
      }

      const inputResult = validateInput(dirPath);
      if (inputResult) {
        throw new AppError(400, inputResult.message || 'Invalid path');
      }

      validateMediaDirectoryPath(dirPath);

      if (isSensitiveDirectory(dirPath)) {
        console.warn(
          `[Security] Blocked attempt to add sensitive directory: ${dirPath}`,
        );
        return res.status(403).json({
          error: 'Access restricted for sensitive system directories',
        });
      }

      let resolvedPath: string;
      try {
        resolvedPath = await fs.realpath(dirPath);
      } catch {
        throw new AppError(400, 'Directory does not exist');
      }

      if (isSensitiveDirectory(resolvedPath)) {
        console.warn(
          `[Security] Blocked attempt to add sensitive directory (resolved): ${resolvedPath}`,
        );
        return res.status(403).json({
          error: 'Access restricted for sensitive system directories',
        });
      }

      await addMediaDirectory(resolvedPath);
      res.json(resolvedPath);
    }),
  );

  router.delete(
    '/api/directories',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const { path: dirPath } = req.body;
      if (!dirPath) {
        throw new AppError(400, 'Missing path');
      }
      if (typeof dirPath !== 'string') {
        throw new AppError(400, 'Invalid path');
      }
      const inputResult = validateInput(dirPath);
      if (inputResult) {
        throw new AppError(400, inputResult.message || 'Invalid path');
      }
      await removeMediaDirectory(dirPath);
      res.sendStatus(200);
    }),
  );

  router.put(
    '/api/directories/active',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const { path: dirPath, isActive } = req.body;
      if (!dirPath) {
        throw new AppError(400, 'Missing path');
      }
      if (typeof dirPath !== 'string') {
        throw new AppError(400, 'Invalid path');
      }
      const inputResult = validateInput(dirPath);
      if (inputResult) {
        throw new AppError(400, inputResult.message || 'Invalid path');
      }
      await setDirectoryActiveState(dirPath, isActive);
      res.sendStatus(200);
    }),
  );

  const fsRateLimiter = createRateLimiter(
    RATE_LIMIT_FS_READ_WINDOW_MS,
    RATE_LIMIT_FS_READ_MAX_REQUESTS,
    'Too many file system requests. Please slow down.',
  );

  router.get(
    '/api/fs/ls',
    fsRateLimiter,
    asyncHandler(async (req, res) => {
      const dirPath = getQueryParam(req.query, 'path');
      if (!dirPath || typeof dirPath !== 'string') {
        throw new AppError(400, 'Missing path');
      }

      const inputResult = validateInput(dirPath);
      if (inputResult) {
        throw new AppError(400, inputResult.message || 'Invalid path');
      }

      const normalizedDirPath = path.resolve(dirPath);

      if (isRestrictedPath(normalizedDirPath)) {
        console.warn(
          `[Security] Blocked attempt to list restricted directory: ${normalizedDirPath}`,
        );
        throw new AppError(403, 'Access denied');
      }

      const contents = await listDirectory(normalizedDirPath);
      res.json(contents);
    }),
  );

  router.get(
    '/api/fs/parent',
    fsRateLimiter,
    asyncHandler(async (req, res) => {
      const dirPath = getQueryParam(req.query, 'path');
      if (!dirPath || typeof dirPath !== 'string') {
        throw new AppError(400, 'Missing path');
      }
      const inputResult = validateInput(dirPath);
      if (inputResult) {
        throw new AppError(400, inputResult.message || 'Invalid path');
      }

      const parent = path.dirname(dirPath);
      if (parent === dirPath) {
        return res.json({ parent: null });
      }
      res.json({ parent });
    }),
  );

  router.get(
    '/api/config/extensions',
    limiters.readLimiter,
    asyncHandler(async (_req, res) => {
      res.json({
        images: SUPPORTED_IMAGE_EXTENSIONS,
        videos: SUPPORTED_VIDEO_EXTENSIONS,
        all: ALL_SUPPORTED_EXTENSIONS,
      });
    }),
  );

  router.post(
    '/api/sources/google-drive',
    limiters.writeLimiter,
    asyncHandler(async (req, res) => {
      const { folderId } = req.body;
      if (!folderId) {
        throw new AppError(400, 'Missing folderId');
      }

      const drive = await getDriveClient();
      const driveRes = await drive.files.get({
        fileId: folderId,
        fields: 'id, name',
      });
      const name = driveRes.data.name || 'Google Drive Folder';

      await addMediaDirectory(`gdrive://${driveRes.data.id}`);

      res.json({ success: true, name });
    }),
  );

  router.get(
    '/api/drive/files',
    fsRateLimiter,
    asyncHandler(async (req, res) => {
      const folderId = getQueryParam(req.query, 'folderId');
      const files = await listDriveDirectory(folderId || 'root');
      res.json(files);
    }),
  );

  router.get(
    '/api/drive/parent',
    fsRateLimiter,
    asyncHandler(async (req, res) => {
      const folderId = getQueryParam(req.query, 'folderId');
      if (!folderId) {
        throw new AppError(400, 'Missing folderId');
      }

      const parent = await getDriveParent(folderId);
      res.json({ parent });
    }),
  );

  return router;
}
