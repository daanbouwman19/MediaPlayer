import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { validatePathAccess } from '../utils/security-utils';
import { filterAuthorizedLibraryPaths } from '../../core/media/utils/authorized-paths';
import {
  upsertMetadata,
  getMetadata,
  setRating,
  createSmartPlaylist,
  getSmartPlaylists,
  deleteSmartPlaylist,
  updateSmartPlaylist,
  updateWatchedSegments,
  updatePlaybackPosition,
  executeSmartPlaylist,
  getAllMetadataAndStats,
} from '../../core/database/database';
import {
  normalizeWatchedSegments,
  parseMetadataUpdate,
} from '../../core/database/metadata-validation';
import { handleIpc } from '../utils/ipc-helper';

/** IPC payloads are untyped at runtime; reject a non-string path early. */
function assertFilePath(filePath: unknown): asserts filePath is string {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('Invalid file path');
  }
}

export function registerDatabaseHandlers() {
  handleIpc(
    IPC_CHANNELS.DB_UPSERT_METADATA,
    async (_event: IpcMainInvokeEvent, { filePath, metadata }) => {
      // The facade keeps only known fields and applies filePath last.
      await upsertMetadata(filePath, metadata);
    },
    {
      validators: [
        async ({ filePath }) => {
          assertFilePath(filePath);
          await validatePathAccess(filePath);
        },
        ({ metadata }) => {
          parseMetadataUpdate(metadata);
        },
      ],
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_GET_METADATA,
    async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
      // Rows are keyed by the library's spelling, not the resolved real path.
      const allowedPaths = await filterAuthorizedLibraryPaths(filePaths);
      return getMetadata(allowedPaths);
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_SET_RATING,
    async (_event: IpcMainInvokeEvent, { filePath, rating }) => {
      await setRating(filePath, rating);
    },
    {
      validators: [
        async ({ filePath }) => {
          await validatePathAccess(filePath);
        },
      ],
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_CREATE_SMART_PLAYLIST,
    async (_event: IpcMainInvokeEvent, { name, criteria }) => {
      return createSmartPlaylist(name, criteria);
    },
  );

  handleIpc(IPC_CHANNELS.DB_GET_SMART_PLAYLISTS, async () => {
    return getSmartPlaylists();
  });

  handleIpc(
    IPC_CHANNELS.DB_DELETE_SMART_PLAYLIST,
    async (_event: IpcMainInvokeEvent, id: number) => {
      await deleteSmartPlaylist(id);
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_UPDATE_SMART_PLAYLIST,
    async (_event: IpcMainInvokeEvent, { id, name, criteria }) => {
      await updateSmartPlaylist(id, name, criteria);
    },
  );
  handleIpc(
    IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS,
    async (_event: IpcMainInvokeEvent, { filePath, segmentsJson }) => {
      await updateWatchedSegments(filePath, segmentsJson);
    },
    {
      validators: [
        async ({ filePath }) => {
          assertFilePath(filePath);
          await validatePathAccess(filePath);
        },
        // Same limits as POST /api/media/watched-segments.
        ({ segmentsJson }) => {
          normalizeWatchedSegments(segmentsJson);
        },
      ],
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_UPDATE_PLAYBACK_POSITION,
    async (_event: IpcMainInvokeEvent, { filePath, position }) => {
      await updatePlaybackPosition(filePath, position);
    },
    {
      validators: [
        async ({ filePath }) => {
          await validatePathAccess(filePath);
        },
      ],
    },
  );

  handleIpc(
    IPC_CHANNELS.DB_EXECUTE_SMART_PLAYLIST,
    async (_event: IpcMainInvokeEvent, criteria: string) => {
      return executeSmartPlaylist(criteria);
    },
    {
      validators: [
        // Mirrors the web route's guard in system.routes.ts
        async (criteria) => {
          if (typeof criteria !== 'string' || criteria.length > 10000) {
            throw new Error('Invalid criteria');
          }
        },
      ],
    },
  );

  handleIpc(IPC_CHANNELS.DB_GET_ALL_METADATA_AND_STATS, async () => {
    return getAllMetadataAndStats();
  });
}
