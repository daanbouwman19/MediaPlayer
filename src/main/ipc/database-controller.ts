import { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import {
  validatePathAccess,
  filterAuthorizedPaths,
} from '../utils/security-utils';
import {
  upsertMetadata,
  getMetadata,
  setRating,
  createSmartPlaylist,
  getSmartPlaylists,
  deleteSmartPlaylist,
  updateSmartPlaylist,
  updateWatchedSegments,
  executeSmartPlaylist,
  getAllMetadataAndStats,
} from '../database';
import { handleIpc } from '../utils/ipc-helper';

export function registerDatabaseHandlers() {
  handleIpc(
    IPC_CHANNELS.DB_UPSERT_METADATA,
    async (_event: IpcMainInvokeEvent, { filePath, metadata }) => {
      await upsertMetadata(filePath, metadata);
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
    IPC_CHANNELS.DB_GET_METADATA,
    async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
      const allowedPaths = await filterAuthorizedPaths(filePaths);
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
  );

  handleIpc(IPC_CHANNELS.DB_GET_ALL_METADATA_AND_STATS, async () => {
    return getAllMetadataAndStats();
  });
}
