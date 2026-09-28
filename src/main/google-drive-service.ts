import type { drive_v3 } from 'googleapis';
import { getOAuth2Client, loadSavedCredentialsIfExist } from './google-auth.ts';
import { Readable } from 'stream';
import type { MediaFile, Album } from '../core/media/types.ts';
import { createDrivePath } from '../core/media/media-utils.ts';
import { callWithRetry } from '../core/media/utils/async-utils.ts';
import {
  SUPPORTED_IMAGE_EXTENSIONS_SET,
  SUPPORTED_VIDEO_EXTENSIONS_SET,
} from '../core/media/constants.ts';
import { AppError } from '../core/media/errors.ts';

const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';
const DRIVE_SHORTCUT_MIME_TYPE = 'application/vnd.google-apps.shortcut';

/**
 * Safety cap on folder nesting during a scan. The visited set already stops
 * shortcut cycles, so this only bounds pathological trees; folders beyond it
 * are skipped and reported in the log.
 */
const MAX_SCAN_DEPTH = 100;

/** The largest page size files.list accepts. */
const DRIVE_LIST_PAGE_SIZE = 1000;

/** Drive's 403 reasons for throttling (as opposed to a real permission error). */
const DRIVE_RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
]);

/**
 * Extension to append when a Drive file's name lacks one that matches its
 * MIME type. The renderer classifies media by name extension, as the local
 * scanner does, so the stored name has to carry the right one.
 */
const MIME_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'video/x-matroska': '.mkv',
  'video/x-ms-wmv': '.wmv',
  'video/x-flv': '.flv',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function collectReasons(errors: unknown, reasons: Set<string>): void {
  if (!Array.isArray(errors)) return;
  for (const entry of errors as unknown[]) {
    if (isRecord(entry) && typeof entry.reason === 'string') {
      reasons.add(entry.reason);
    }
  }
}

/**
 * Collects Drive's error reasons from a failed request. gaxios 7 puts the
 * parsed API error (including Drive's errors[]) on `cause`; the raw body is
 * on response.data, where streamed responses leave it as an unparsed string.
 * Older gaxios versions exposed errors[] on the error itself.
 */
function getDriveErrorReasons(error: unknown): Set<string> {
  const reasons = new Set<string>();
  if (!isRecord(error)) return reasons;

  if (isRecord(error.cause)) collectReasons(error.cause.errors, reasons);

  if (isRecord(error.response)) {
    let body: unknown = error.response.data;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body) as unknown;
      } catch {
        body = undefined;
      }
    }
    if (isRecord(body) && isRecord(body.error)) {
      collectReasons(body.error.errors, reasons);
    }
  }

  collectReasons(error.errors, reasons);
  return reasons;
}

/**
 * The HTTP status of a failed Drive request. GaxiosError.code is only numeric
 * for API errors (it is e.g. 'ECONNRESET' for network errors), so prefer the
 * response status.
 */
function getDriveErrorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.status === 'number') return error.status;
  if (isRecord(error.response) && typeof error.response.status === 'number') {
    return error.response.status;
  }
  return typeof error.code === 'number' ? error.code : undefined;
}

function isDriveQuotaError(error: unknown): boolean {
  if (getDriveErrorStatus(error) !== 403) return false;
  for (const reason of getDriveErrorReasons(error)) {
    if (DRIVE_RATE_LIMIT_REASONS.has(reason)) return true;
  }
  return false;
}

const DRIVE_RETRY_OPTIONS = {
  shouldRetry: (error: unknown) => {
    const status = getDriveErrorStatus(error);
    return (
      status === 429 ||
      isDriveQuotaError(error) ||
      (status !== undefined && status >= 500 && status < 600)
    );
  },
  onRetry: (error: unknown, _retriesRemaining: number, delay: number) => {
    console.warn(
      `[GoogleDrive] Rate limited or server error (${getDriveErrorStatus(error)}). Retrying in ${delay}ms...`,
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
  if (!folderId) throw new AppError(400, 'Missing folder ID');
  if (folderId === 'root') return;
  // Drive IDs are typically alphanumeric + [-_]
  // We use a regex to ensure no special chars are injected.
  if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    console.warn(`[Security] Blocked invalid Drive folder ID: ${folderId}`);
    throw new AppError(400, 'Invalid folder ID');
  }
}

/**
 * Fetches every page of a files.list query. Shared drives are always included,
 * matching the other Drive calls.
 */
async function listAllFiles(
  drive: drive_v3.Drive,
  params: { q: string; fields: string; orderBy?: string },
): Promise<drive_v3.Schema$File[]> {
  const allFiles: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined = undefined;

  do {
    const res: { data: drive_v3.Schema$FileList } = await callWithRetry(
      () =>
        drive.files.list({
          ...params,
          pageSize: DRIVE_LIST_PAGE_SIZE,
          ...(pageToken ? { pageToken } : {}),
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        }),
      DRIVE_RETRY_OPTIONS,
    );
    for (const file of res.data.files ?? []) {
      allFiles.push(file);
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return allFiles;
}

/**
 * Looks up a Drive folder's ID and name, following a shortcut to a folder.
 * Throws a 400 AppError when the ID is malformed or doesn't name a folder,
 * so a file can't be saved as an (always empty) folder source.
 */
export async function getDriveFolderInfo(
  folderId: string,
): Promise<{ id: string; name: string }> {
  validateFolderId(folderId);
  const drive = await getDriveClient();
  const res = await callWithRetry(
    () =>
      drive.files.get({
        fileId: folderId,
        fields: 'id, name, mimeType, shortcutDetails',
        supportsAllDrives: true,
      }),
    DRIVE_RETRY_OPTIONS,
  );

  const file = res.data;
  const name = file.name || 'Google Drive Folder';
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE && file.id) {
    return { id: file.id, name };
  }

  const target = file.shortcutDetails;
  if (
    file.mimeType === DRIVE_SHORTCUT_MIME_TYPE &&
    target?.targetMimeType === DRIVE_FOLDER_MIME_TYPE &&
    target.targetId
  ) {
    validateFolderId(target.targetId);
    return { id: target.targetId, name };
  }

  throw new AppError(400, 'Not a Google Drive folder');
}

/**
 * The name's extension, lowercased, using the same rules as the renderer's
 * getCachedExtension (the dot must follow the last separator and must not
 * start the name).
 */
function getNameExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  const lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return lastDot > lastSeparator + 1 ? name.slice(lastDot).toLowerCase() : '';
}

/**
 * Returns the name to store for a Drive media item, or null when the app
 * can't show that format. Drive selects media by MIME type, but the renderer
 * decides between image and video by the name's extension, so a missing or
 * mismatched extension is replaced by appending the MIME type's one, and
 * formats the local scanner would also skip (HEIC, BMP, ...) are dropped.
 */
function getMediaName(name: string, mimeType: string): string | null {
  const extension = getNameExtension(name);
  if (
    (mimeType.startsWith('image/') &&
      SUPPORTED_IMAGE_EXTENSIONS_SET.has(extension)) ||
    (mimeType.startsWith('video/') &&
      SUPPORTED_VIDEO_EXTENSIONS_SET.has(extension))
  ) {
    return name;
  }
  const mimeExtension = MIME_TYPE_EXTENSIONS[mimeType];
  return mimeExtension ? `${name}${mimeExtension}` : null;
}

/**
 * Converts a Drive media file, or a shortcut to one, into a MediaFile whose
 * path is the underlying file. Returns null for anything the app can't show.
 */
function toMediaFile(f: drive_v3.Schema$File): MediaFile | null {
  let fileId = f.id;
  let mimeType = f.mimeType;

  if (mimeType === DRIVE_SHORTCUT_MIME_TYPE) {
    fileId = f.shortcutDetails?.targetId;
    mimeType = f.shortcutDetails?.targetMimeType;
  }

  if (!fileId || !mimeType) return null;
  const name = getMediaName(f.name || 'Untitled', mimeType);
  return name ? { name, path: createDrivePath(fileId) } : null;
}

/** The folder a Drive entry leads to (itself, or a shortcut's target), if any. */
function toSubfolder(
  f: drive_v3.Schema$File,
): { id: string; name: string } | null {
  const name = f.name || 'Untitled Folder';
  if (f.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return f.id ? { id: f.id, name } : null;
  }
  const target = f.shortcutDetails;
  if (
    f.mimeType === DRIVE_SHORTCUT_MIME_TYPE &&
    target?.targetMimeType === DRIVE_FOLDER_MIME_TYPE &&
    target.targetId
  ) {
    return { id: target.targetId, name };
  }
  return null;
}

/** A shortcut found while listing a folder, placed once the real tree is known. */
interface PendingShortcut<T> {
  /** The album of the folder that holds the shortcut. */
  host: Album;
  target: T;
}

/** A shortcut to a folder; the target is nested one level below its host. */
interface PendingFolderShortcut extends PendingShortcut<{
  id: string;
  name: string;
}> {
  hostDepth: number;
}

/** State shared by every folder visited while scanning one Drive root. */
interface DriveScanState {
  drive: drive_v3.Drive;
  /**
   * Folder IDs already claimed for this root's tree. Following a shortcut to
   * one of them would rescan a cycle or add a second album with the same id.
   */
  visitedFolders: Set<string>;
  /** Paths already placed in this root's tree, so a file and a shortcut to it appear once. */
  seenPaths: Set<string>;
  /** Shortcuts to folders, in the order they were listed. */
  folderShortcuts: PendingFolderShortcut[];
  /** Shortcuts to media files, in the order they were listed. */
  mediaShortcuts: PendingShortcut<MediaFile>[];
  /** Folders skipped because they are nested deeper than MAX_SCAN_DEPTH. */
  skippedTooDeep: number;
}

/**
 * Lists a folder and, recursively, its real (non-shortcut) subfolders into
 * an album, claiming every real folder and media file for this root.
 * Shortcuts are only recorded here; resolveShortcuts places them once the
 * whole real tree is known, so a shortcut never takes the place of the item
 * it points at, whatever order Drive lists the folders in.
 */
async function scanRealTree(
  folderId: string,
  name: string,
  depth: number,
  state: DriveScanState,
): Promise<Album> {
  validateFolderId(folderId);
  const entries = await listAllFiles(state.drive, {
    q: `'${folderId}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/' or mimeType = '${DRIVE_FOLDER_MIME_TYPE}' or mimeType = '${DRIVE_SHORTCUT_MIME_TYPE}')`,
    fields: 'nextPageToken, files(id, name, mimeType, shortcutDetails)',
  });

  const album: Album = { id: folderId, name, textures: [], children: [] };
  const subfolders: { id: string; name: string }[] = [];
  for (const entry of entries) {
    const isShortcut = entry.mimeType === DRIVE_SHORTCUT_MIME_TYPE;
    const subfolder = toSubfolder(entry);
    if (subfolder) {
      if (isShortcut) {
        state.folderShortcuts.push({
          host: album,
          hostDepth: depth,
          target: subfolder,
        });
      } else if (!state.visitedFolders.has(subfolder.id)) {
        state.visitedFolders.add(subfolder.id);
        subfolders.push(subfolder);
      }
      continue;
    }

    const mediaFile = toMediaFile(entry);
    if (!mediaFile) continue;
    if (isShortcut) {
      state.mediaShortcuts.push({ host: album, target: mediaFile });
    } else if (!state.seenPaths.has(mediaFile.path)) {
      state.seenPaths.add(mediaFile.path);
      album.textures.push(mediaFile);
    }
  }

  for (const subfolder of subfolders) {
    const child = await scanSubtree(subfolder, depth + 1, state);
    if (child) album.children.push(child);
  }
  return album;
}

/**
 * Scans a subfolder's real tree. Returns null when it is nested too deep or
 * its scan fails (which is logged), so one bad folder only drops its subtree.
 */
async function scanSubtree(
  subfolder: { id: string; name: string },
  depth: number,
  state: DriveScanState,
): Promise<Album | null> {
  if (depth > MAX_SCAN_DEPTH) {
    state.skippedTooDeep++;
    return null;
  }
  try {
    return await scanRealTree(subfolder.id, subfolder.name, depth, state);
  } catch (err) {
    console.error(
      '[GoogleDrive] Skipping folder %s (%s) after an error:',
      subfolder.name,
      subfolder.id,
      err,
    );
    return null;
  }
}

/**
 * Places the shortcuts scanRealTree recorded. A folder shortcut is followed
 * only when its target isn't in the tree yet; the target's real tree is then
 * scanned the same way, and its own shortcuts join the queue. Media
 * shortcuts come last, so a real copy of their target anywhere in the tree,
 * including inside a followed folder, keeps its place.
 */
async function resolveShortcuts(state: DriveScanState): Promise<void> {
  // for...of also visits the shortcuts appended while following earlier ones.
  for (const { host, hostDepth, target } of state.folderShortcuts) {
    if (state.visitedFolders.has(target.id)) continue;
    state.visitedFolders.add(target.id);
    const child = await scanSubtree(target, hostDepth + 1, state);
    if (child) host.children.push(child);
  }

  for (const { host, target } of state.mediaShortcuts) {
    if (state.seenPaths.has(target.path)) continue;
    state.seenPaths.add(target.path);
    host.textures.push(target);
  }
}

/** Drops subalbums without any media below them, as the local scanner does. */
function pruneEmptyAlbums(album: Album): void {
  album.children = album.children.filter((child) => {
    pruneEmptyAlbums(child);
    return child.textures.length > 0 || child.children.length > 0;
  });
}

/**
 * Scans a Drive folder and all its subfolders into an album tree named after
 * the folder. Every folder is listed completely (all pages) and at most once,
 * however many shortcuts lead to it. Files and folders that really are in the
 * tree keep their place, and shortcuts only add what the tree lacks. A
 * failing subfolder only drops that subtree.
 */
export async function listDriveFiles(folderId: string): Promise<Album> {
  const folder = await getDriveFolderInfo(folderId);
  const state: DriveScanState = {
    drive: await getDriveClient(),
    visitedFolders: new Set([folderId, folder.id]),
    seenPaths: new Set(),
    folderShortcuts: [],
    mediaShortcuts: [],
    skippedTooDeep: 0,
  };

  const album = await scanRealTree(folder.id, folder.name, 0, state);
  await resolveShortcuts(state);
  // Prune only now: a folder may hold nothing but shortcuts.
  pruneEmptyAlbums(album);
  if (state.skippedTooDeep > 0) {
    console.warn(
      `[GoogleDrive] Skipped ${state.skippedTooDeep} folder(s) nested more than ${MAX_SCAN_DEPTH} levels below '${folder.name}' (${folderId}).`,
    );
  }
  // Keep the source's own ID (e.g. 'root', or a shortcut) as the album ID.
  album.id = folderId;
  return album;
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
    const files = await listAllFiles(drive, {
      q,
      fields: 'nextPageToken, files(id, name, mimeType, shortcutDetails)',
      orderBy: 'folder,name',
    });

    console.log(
      `[GoogleDrive] listDriveDirectory '${queryId}' found ${files.length} items.`,
    );
    return files.map((f) => {
      let isDir = f.mimeType === DRIVE_FOLDER_MIME_TYPE;
      let id = f.id;

      if (f.mimeType === DRIVE_SHORTCUT_MIME_TYPE && f.shortcutDetails) {
        if (f.shortcutDetails.targetMimeType === DRIVE_FOLDER_MIME_TYPE) {
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

    const parent = res.data.parents?.[0];
    if (parent) {
      return parent;
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
        {
          fileId,
          alt: 'media',
          acknowledgeAbuse: true,
          // Without this, Drive answers 404 for files in shared drives.
          supportsAllDrives: true,
        },
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
    // [SECURITY] The OAuth bearer token is attached below; only send it to
    // Google-controlled hosts, never wherever the returned URL happens to point.
    const thumbnailHost = new URL(meta.data.thumbnailLink).hostname;
    if (
      !thumbnailHost.endsWith('.googleusercontent.com') &&
      !thumbnailHost.endsWith('.google.com')
    ) {
      throw new Error('Untrusted thumbnail URL host');
    }

    // We need to fetch this URL. The googleapis library doesn't have a helper for arbitrary URLs.
    // We can use the global fetch (Node 18+) or axios if available.
    // We need to attach the Auth header.
    const auth = getOAuth2Client();
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
