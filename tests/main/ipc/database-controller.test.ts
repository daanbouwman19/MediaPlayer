import { describe, it, expect, vi, beforeEach, Mock } from 'vite-plus/test';
import { registerDatabaseHandlers } from '../../../src/main/ipc/database-controller';
import { IPC_CHANNELS } from '../../../src/shared/ipc-channels';
import { handleIpc } from '../../../src/main/utils/ipc-helper';
import { validatePathAccess } from '../../../src/main/utils/security-utils';
import { filterAuthorizedLibraryPaths } from '../../../src/core/media/utils/authorized-paths';
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
  getAllMetadataAndStats,
} from '../../../src/core/database/database';

vi.mock('../../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn(),
}));

vi.mock('../../../src/main/utils/security-utils', () => ({
  validatePathAccess: vi.fn(),
}));

vi.mock('../../../src/core/media/utils/authorized-paths', () => ({
  filterAuthorizedLibraryPaths: vi.fn(),
}));

vi.mock('../../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  upsertMetadata: vi.fn(),
  getMetadata: vi.fn(),
  setRating: vi.fn(),
  createSmartPlaylist: vi.fn(),
  getSmartPlaylists: vi.fn(),
  deleteSmartPlaylist: vi.fn(),
  updateSmartPlaylist: vi.fn(),
  updateWatchedSegments: vi.fn(),
  updatePlaybackPosition: vi.fn(),
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

    it('rejects metadata fields with the wrong type (F13)', () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_UPSERT_METADATA,
      )!;
      const [, validateMetadata] = call[2].validators;
      expect(() =>
        validateMetadata({ filePath: '/p', metadata: { rating: 3 } }),
      ).not.toThrow();
      expect(() =>
        validateMetadata({ filePath: '/p', metadata: { rating: 'x' } }),
      ).toThrow('Invalid metadata field: rating');
      expect(() =>
        validateMetadata({ filePath: '/p', metadata: null }),
      ).toThrow('Metadata must be an object');
    });
  });

  describe('DB_GET_METADATA', () => {
    it('gets metadata for authorized paths, keyed by the library spelling', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_GET_METADATA);
      (filterAuthorizedLibraryPaths as Mock).mockResolvedValue(['/path']);
      (getMetadata as Mock).mockResolvedValue([{ duration: 10 }]);

      const result = await handler({}, ['/path']);

      expect(filterAuthorizedLibraryPaths).toHaveBeenCalledWith(['/path']);
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

  describe('DB_EXECUTE_SMART_PLAYLIST', () => {
    const getValidator = () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_EXECUTE_SMART_PLAYLIST,
      )!;
      return call[2].validators[0];
    };

    it('accepts a valid criteria string', async () => {
      await expect(getValidator()('{"minRating":3}')).resolves.toBeUndefined();
    });

    it('rejects non-string criteria', async () => {
      await expect(getValidator()({ evil: true })).rejects.toThrow(
        'Invalid criteria',
      );
    });

    it('rejects oversized criteria', async () => {
      await expect(getValidator()('x'.repeat(10001))).rejects.toThrow(
        'Invalid criteria',
      );
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

    it('applies the same segment limits as the web route', () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS,
      )!;
      const [, validateSegments] = call[2].validators;
      expect(() =>
        validateSegments({ filePath: '/v.mp4', segmentsJson: '[]' }),
      ).not.toThrow();
      expect(() =>
        validateSegments({ filePath: '/v.mp4', segmentsJson: '{bad' }),
      ).toThrow('valid JSON');
      expect(() =>
        validateSegments({
          filePath: '/v.mp4',
          segmentsJson: JSON.stringify(
            Array.from({ length: 5001 }, (_, i) => ({ start: i, end: i })),
          ),
        }),
      ).toThrow('Too many watched segments');
    });

    it('rejects a non-string path before checking access', async () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_UPDATE_WATCHED_SEGMENTS,
      )!;
      await expect(call[2].validators[0]({ filePath: 42 })).rejects.toThrow(
        'Invalid file path',
      );
      expect(validatePathAccess).not.toHaveBeenCalled();
    });
  });

  describe('DB_UPDATE_PLAYBACK_POSITION', () => {
    it('updates playback position', async () => {
      const handler = getHandler(IPC_CHANNELS.DB_UPDATE_PLAYBACK_POSITION);
      await handler({}, { filePath: '/path/to/video.mp4', position: 42.5 });
      expect(updatePlaybackPosition).toHaveBeenCalledWith(
        '/path/to/video.mp4',
        42.5,
      );
    });

    it('validates path for playback position', () => {
      const call = (handleIpc as Mock).mock.calls.find(
        (c) => c[0] === IPC_CHANNELS.DB_UPDATE_PLAYBACK_POSITION,
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
