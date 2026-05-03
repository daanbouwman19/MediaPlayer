import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { registerDatabaseHandlers } from '../../../src/main/ipc/database-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import {
  validatePathAccess,
  filterAuthorizedPaths,
} from '../../../src/main/utils/security-utils';
import {
  upsertMetadata,
  getMetadata,
  setRating,
  createSmartPlaylist,
  getSmartPlaylists,
  deleteSmartPlaylist,
  updateSmartPlaylist,
  updateWatchedSegments,
  getAllMetadataAndStats,
} from '../../../src/core/database';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/main/utils/security-utils', () => ({
  validatePathAccess: vi.fn(),
  filterAuthorizedPaths: vi.fn(),
}));

vi.mock('../../../src/core/database', () => ({
  isFileInLibrary: vi.fn(),
  upsertMetadata: vi.fn(),
  getMetadata: vi.fn(),
  setRating: vi.fn(),
  createSmartPlaylist: vi.fn(),
  getSmartPlaylists: vi.fn(),
  deleteSmartPlaylist: vi.fn(),
  updateSmartPlaylist: vi.fn(),
  updateWatchedSegments: vi.fn(),
  getAllMetadataAndStats: vi.fn(),
}));

describe('database-controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (handleIpc as Mock).mockClear();
    registerDatabaseHandlers();
  });

  const getHandler = (channel: string) => {
    const call = (handleIpc as Mock).mock.calls.find((c) => c[0] === channel);
    if (!call) throw new Error(`Handler for ${channel} not found`);
    return call[1];
  };

  describe('DB_UPSERT_METADATA', () => {
    it('upserts metadata', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_UPSERT_METADATA);
      const payload = { filePath: '/path', metadata: { duration: 10 } };
      await handler({}, payload);
      expect(upsertMetadata).toHaveBeenCalledWith('/path', { duration: 10 });
    });

    it('validates path', () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_UPSERT_METADATA,
      )!;
      const validator = call[2].validators[0];
      validator({ filePath: '/path' });
      expect(validatePathAccess).toHaveBeenCalledWith('/path');
    });
  });

  describe('DB_GET_METADATA', () => {
    it('gets metadata for authorized paths', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_GET_METADATA);
      (filterAuthorizedPaths as Mock).mockResolvedValue(['/path']);
      (getMetadata as Mock).mockResolvedValue([{ duration: 10 }]);

      const result = await handler({}, ['/path']);

      expect(filterAuthorizedPaths).toHaveBeenCalledWith(['/path']);
      expect(getMetadata).toHaveBeenCalledWith(['/path']);
      expect(result).toEqual([{ duration: 10 }]);
    });
  });

  describe('DB_SET_RATING', () => {
    it('sets rating', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_SET_RATING);
      await handler({}, { filePath: '/path', rating: 5 });
      expect(setRating).toHaveBeenCalledWith('/path', 5);
    });
  });

  describe('DB_CREATE_SMART_PLAYLIST', () => {
    it('creates playlist', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_CREATE_SMART_PLAYLIST);
      (createSmartPlaylist as Mock).mockResolvedValue({ id: 1 });
      const result = await handler({}, { name: 'List', criteria: '{}' });
      expect(createSmartPlaylist).toHaveBeenCalledWith('List', '{}');
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('DB_GET_SMART_PLAYLISTS', () => {
    it('gets playlists', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_GET_SMART_PLAYLISTS);
      (getSmartPlaylists as Mock).mockResolvedValue([]);
      const result = await handler({});
      expect(result).toEqual([]);
    });
  });

  describe('DB_DELETE_SMART_PLAYLIST', () => {
    it('deletes playlist', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_DELETE_SMART_PLAYLIST);
      await handler({}, 1);
      expect(deleteSmartPlaylist).toHaveBeenCalledWith(1);
    });
  });

  describe('DB_UPDATE_SMART_PLAYLIST', () => {
    it('updates playlist', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_UPDATE_SMART_PLAYLIST);
      await handler({}, { id: 1, name: 'New', criteria: '{}' });
      expect(updateSmartPlaylist).toHaveBeenCalledWith(1, 'New', '{}');
    });
  });

  describe('DB_UPDATE_WATCHED_SEGMENTS', () => {
    it('updates watched segments', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS);
      await handler(
        {},
        {
          filePath: '/path/to/video.mp4',
          segmentsJson: JSON.stringify([{ start: 0, end: 10 }]),
        },
      );
      expect(updateWatchedSegments).toHaveBeenCalledWith(
        '/path/to/video.mp4',
        JSON.stringify([{ start: 0, end: 10 }]),
      );
    });

    it('validates path for watched segments', () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS,
      )!;
      const validator = call[2].validators[0];
      validator({ filePath: '/path/to/video.mp4' });
      expect(validatePathAccess).toHaveBeenCalledWith('/path/to/video.mp4');
    });
  });

  describe('DB_GET_ALL_METADATA_AND_STATS', () => {
    it('gets all', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_GET_ALL_METADATA_AND_STATS);
      (getAllMetadataAndStats as Mock).mockResolvedValue([]);
      const result = await handler({});
      expect(result).toEqual([]);
    });
  });
});
