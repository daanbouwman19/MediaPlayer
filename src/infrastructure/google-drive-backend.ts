/**
 * @file Google Drive implementation of the core DriveBackend port.
 *
 * Adapts the googleapis Drive service, the OAuth client and the on-disk
 * download cache to the interface src/core depends on. The Electron main
 * process, the web server and the scan worker register it at startup, so
 * src/core never imports these modules itself.
 */
import type { DriveBackend } from '../core/media/drive-backend.ts';
import {
  getDriveFileMetadata,
  getDriveFileStream,
  listDriveFiles,
} from '../main/google-drive-service.ts';
import { initializeManualCredentials } from '../main/google-auth.ts';
import { getDriveCacheManager } from '../main/drive-cache-manager.ts';

export const googleDriveBackend: DriveBackend = {
  getFileMetadata: (fileId) => getDriveFileMetadata(fileId),
  getFileStream: (fileId, range) => getDriveFileStream(fileId, range),
  listFolder: (folderId) => listDriveFiles(folderId),
  setCredentials: (tokens) => initializeManualCredentials(tokens),
  getCachedFile: (fileId) => getDriveCacheManager().getCachedFilePath(fileId),
};
