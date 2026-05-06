import type { drive_v3 } from 'googleapis';
import { getOAuth2Client, loadSavedCredentialsIfExist } from './google-auth.ts';
import { Readable } from 'stream';
import type { MediaFile, Album } from '../core/types.ts';
import { createDrivePath } from '../core/media-utils.ts';
import { callWithRetry } from '../core/utils/async-utils.ts';

const MAX_SCAN_DEPTH = 5;

function isDriveQuotaError(error: unknown): boolean {
  const err = error as { code?: number; errors?: { reason?: string }[] };
  if (err.code !== 403) return false;
  const reason = err.errors?.[0]?.reason ?? '';
  return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
}

const DRIVE_RETRY_OPTIONS = {
  shouldRetry: (error: unknown) => {
    const err = error as { code?: number };
    return (
      err.code === 429 ||
      isDriveQuotaError(error) ||
      (typeof err.code === 'number' && err.code >= 500 && err.code < 600)
    );
  },
  onRetry: (error: unknown, _retriesRemaining: number, delay: number) => {
    const err = error as { code?: number };
    console.warn(
      `[GoogleDrive] Rate limited or server error (${err.code}). Retrying in ${delay}ms...`,
    );
  },
};

let driveClient: drive_v3.Drive | null = null;

export function resetDriveClient() {
  driveClient = null;
}

export async function getDriveClient(): Promise<drive_v3.Drive> {
  if (driveClient) return driveClient;

  const auth = getOAuth2Client();
  // Ensure credentials are loaded
  if (!auth.credentials || !auth.credentials.refresh_token) {
    const loaded = await loadSavedCredentialsIfExist();
    if (!loaded) {
      throw new Error('User not authenticated with Google Drive');
    }
  }

  const { google } = await import('googleapis');
  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

/**
 * Validates a Google Drive Folder ID.
 * Allowed: 'root', alphanumeric, dash, underscore.
 * Throws if invalid.
 */
function validateFolderId(folderId: string): void {
  if (!folderId) throw new Error('Missing folder ID');
  if (folderId === 'root') return;
  // Drive IDs are typically alphanumeric + [-_]
  // We use a regex to ensure no special chars are injected.
  if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    console.warn(`[Security] Blocked invalid Drive folder ID: ${folderId}`);
    throw new Error('Invalid folder ID');
  }
}

/**
 * Processes a single Drive file to determine if it is a valid media file.
 * Handles shortcut resolution.
 */
function processDriveFile(f: drive_v3.Schema$File): MediaFile | null {
  if (f.mimeType === 'application/vnd.google-apps.shortcut') {
    const { targetId, targetMimeType } = f.shortcutDetails || {};

    // A shortcut is only valid if it points to a media file and has a target ID.
    if (
      targetId &&
      targetMimeType &&
      (targetMimeType.includes('image/') || targetMimeType.includes('video/'))
    ) {
      return {
        name: f.name || 'Untitled',
        path: createDrivePath(targetId),
      };
    }

    // Invalid or non-media shortcut, so we ignore it.
    return null;
  }

  // For regular files, we rely on the API query having filtered for media types.
  // A file without an ID is not usable.
  if (!f.id) {
    return null;
  }

  return {
    name: f.name || 'Untitled',
    path: createDrivePath(f.id),
  };
}

/**
 * Lists files in a specific Google Drive folder.
 * Currently implements a flat list mapped to an Album structure for simplicity in the MVP.
 * For recursive structures, we might need a more complex traversal.
 */
// ... existing code ...
export async function listDriveFiles(
  folderId: string,
  depth = 0,
): Promise<Album> {
  if (depth >= MAX_SCAN_DEPTH) {
    console.warn(
      `[GoogleDrive] Max scan depth (${MAX_SCAN_DEPTH}) reached at folder ${folderId}, skipping subtree.`,
    );
    return {
      id: folderId,
      name: 'Google Drive Folder',
      textures: [],
      children: [],
    };
  }
  validateFolderId(folderId);
  const drive = await getDriveClient();
  const q = `'${folderId}' in parents and (mimeType contains 'image/' or mimeType contains 'video/' or mimeType = 'application/vnd.google-apps.shortcut') and trashed = false`;

  let allFiles: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const res: { data: drive_v3.Schema$FileList } = await callWithRetry(
      () =>
        drive.files.list({
          q,
          fields:
            'nextPageToken, files(id, name, mimeType, size, createdTime, shortcutDetails)',
          pageSize: 1000,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
      DRIVE_RETRY_OPTIONS,
    );
    if (res.data.files) {
      allFiles = allFiles.concat(res.data.files);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  const textures: MediaFile[] = allFiles
    .map(processDriveFile)
    .filter((file): file is MediaFile => file !== null);

  // For MVP, we are not recursively fetching subfolders yet, or we can add that logic.
  // The user requirement said: "List files in a specific Drive folder (recursively or flat)."
  // Let's stick to flat for the immediate folder for now, or implement simple recursion.

  // Let's try to find subfolders too to build the tree.
  // We need to include shortcuts to folders too.
  const folderQ = `'${folderId}' in parents and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.shortcut') and trashed = false`;
  const folderRes = await callWithRetry(
    () =>
      drive.files.list({
        q: folderQ,
        fields: 'files(id, name, mimeType, shortcutDetails)',
        pageSize: 100,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      }),
    DRIVE_RETRY_OPTIONS,
  );

  const subfolders = folderRes.data.files || [];
  const children: Album[] = [];

  for (const subfolder of subfolders) {
    let targetId = subfolder.id;
    let isFolder = subfolder.mimeType === 'application/vnd.google-apps.folder';

    if (
      subfolder.mimeType === 'application/vnd.google-apps.shortcut' &&
      subfolder.shortcutDetails?.targetMimeType ===
        'application/vnd.google-apps.folder'
    ) {
      targetId = subfolder.shortcutDetails.targetId;
      isFolder = true;
    }

    if (targetId && isFolder) {
      const subAlbum = await listDriveFiles(targetId, depth + 1);
      subAlbum.name = subfolder.name || 'Untitled Folder';
      children.push(subAlbum);
    }
  }

  return {
    id: folderId,
    name: 'Google Drive Folder', // Caller should overwrite this with actual root name
    textures,
    children,
  };
}

/**
 * Lists files and folders for browsing (File Explorer style).
 * Returns FileSystemEntry[] compatible structure.
 */
export async function listDriveDirectory(
  folderId: string,
): Promise<{ name: string; path: string; isDirectory: boolean }[]> {
  const drive = await getDriveClient();

  // Handle 'root' explicitly if passed
  const queryId = folderId === 'root' ? 'root' : folderId;
  validateFolderId(queryId);

  const q = `'${queryId}' in parents and trashed = false`;
  try {
    let allFiles: drive_v3.Schema$File[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const res: { data: drive_v3.Schema$FileList } = await callWithRetry(
        () =>
          drive.files.list({
            q,
            fields: 'nextPageToken, files(id, name, mimeType, shortcutDetails)',
            pageSize: 1000,
            pageToken,
            orderBy: 'folder,name',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
          }),
        DRIVE_RETRY_OPTIONS,
      );
      if (res.data.files) {
        allFiles = allFiles.concat(res.data.files);
      }
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);

    const files = allFiles;
    console.log(
      `[GoogleDrive] listDriveDirectory '${queryId}' found ${files.length} items.`,
    );
    return files.map((f) => {
      let isDir = f.mimeType === 'application/vnd.google-apps.folder';
      let id = f.id;

      if (
        f.mimeType === 'application/vnd.google-apps.shortcut' &&
        f.shortcutDetails
      ) {
        if (
          f.shortcutDetails.targetMimeType ===
          'application/vnd.google-apps.folder'
        ) {
          isDir = true;
          // IMPORTANT: Navigate to the TARGET ID, not the shortcut ID
          id = f.shortcutDetails.targetId;
        }
      }

      return {
        name: f.name || 'Untitled',
        path: id || '', // We use ID as "path" for internal navigation in this mode
        isDirectory: isDir,
      };
    });
  } catch (err) {
    console.error(
      '[GoogleDriveService] Error listing files for query %s:',
      q,
      err,
    );
    throw err;
  }
}

export async function getDriveParent(folderId: string): Promise<string | null> {
  if (!folderId || folderId === 'root') return null;
  validateFolderId(folderId);

  const drive = await getDriveClient();
  try {
    const res = await callWithRetry(
      () =>
        drive.files.get({
          fileId: folderId,
          fields: 'parents',
          supportsAllDrives: true,
        }),
      DRIVE_RETRY_OPTIONS,
    );

    if (res.data.parents && res.data.parents.length > 0) {
      return res.data.parents[0];
    }
  } catch (e) {
    console.warn('Failed to get parent for drive folder %s:', folderId, e);
  }
  return null;
}

export async function getDriveFileStream(
  fileId: string,
  options: { start?: number; end?: number } = {},
): Promise<Readable> {
  const drive = await getDriveClient();
  const headers: { [key: string]: string } = {};

  if (options.start !== undefined || options.end !== undefined) {
    const start = options.start !== undefined ? options.start : '';
    const end = options.end !== undefined ? options.end : '';
    headers['Range'] = `bytes=${start}-${end}`;
  }

  const res = await callWithRetry(
    () =>
      drive.files.get(
        { fileId, alt: 'media', acknowledgeAbuse: true },
        { responseType: 'stream', headers },
      ),
    DRIVE_RETRY_OPTIONS,
  );

  if (res.data) {
    // Debug logging for stream
    console.log('[GoogleDrive] Stream started for %s', fileId);
    res.data.on('end', () =>
      console.log('[GoogleDrive] Stream ended for %s', fileId),
    );
    res.data.on('error', (err) =>
      console.error('[GoogleDrive] Stream error for %s:', fileId, err),
    );
  }

  return res.data;
}

// ... existing code ...
export async function getDriveFileMetadata(
  fileId: string,
): Promise<drive_v3.Schema$File> {
  const drive = await getDriveClient();
  const res = await callWithRetry(
    () =>
      drive.files.get({
        fileId,
        fields: 'id, name, mimeType, size, createdTime, videoMediaMetadata',
        supportsAllDrives: true,
      }),
    DRIVE_RETRY_OPTIONS,
  );
  return res.data;
}

export async function getDriveFileThumbnail(fileId: string): Promise<Readable> {
  const drive = await getDriveClient();
  // We can try to get the thumbnail link, but that's a public URL (sometimes).
  // A better way for private app access is 'files.get' with 'alt=media' if it's an image.
  // But for videos, 'alt=media' downloads the VIDEO.
  // The Drive API 'thumbnailLink' field is often short-lived or requires cookies.
  // However, for MVP, if the file is an image, we can just download it (alt=media).
  // If it's a video, Drive doesn't provide a direct "thumbnail download" stream easily via API
  // without using the thumbnailLink which might need auth headers.
  // Let's first check if we can get the thumbnailLink and pipe it.

  // Actually, for a robust backend implementation:
  // 1. Get metadata to see 'thumbnailLink'.
  // 2. Fetch 'thumbnailLink' using the auth token.
  // Note: thumbnailLink often allows unauthenticated access if the file is public,
  // but for private files, we need to pass the token.

  const meta = await callWithRetry(
    () =>
      drive.files.get({
        fileId,
        fields: 'thumbnailLink, mimeType',
        supportsAllDrives: true,
      }),
    DRIVE_RETRY_OPTIONS,
  );

  if (meta.data.thumbnailLink) {
    // We need to fetch this URL. The googleapis library doesn't have a helper for arbitrary URLs.
    // We can use the global fetch (Node 18+) or axios if available.
    // We need to attach the Auth header.
    const auth = await getOAuth2Client();
    const token = await auth.getAccessToken(); // ensuring we have a token

    const res = await fetch(meta.data.thumbnailLink, {
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch thumbnail: ${res.statusText}`);
    }
    // Convert Web ReadableStream to Node Readable
    // Readable.fromWeb is available in recent Node versions, or we can use a utility
    if (res.body) {
      // Node 18+ has Readable.fromWeb
      return Readable.fromWeb(res.body as import('stream/web').ReadableStream);
    }
  }

  // Fallback: If no thumbnail link (e.g. not generated yet), and it is an image,
  // we can download the file itself (if small?).
  // For now, throw if no thumbnail link.
  throw new Error('No thumbnail available');
}
