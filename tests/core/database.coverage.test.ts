import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  executeSmartPlaylist,
  getAllMetadataAndStats,
  getRecentlyPlayed,
  getPendingMetadata,
  initDatabase,
  closeDatabase,
  upsertMetadata,
  getMetadata,
  setRating,
  createSmartPlaylist,
  getSmartPlaylists,
  deleteSmartPlaylist,
  updateSmartPlaylist,
  updateWatchedSegments,
  saveSetting,
  getSetting,
  recordMediaView,
  getMediaViewCounts,
  addMediaDirectory,
  getMediaDirectories,
  removeMediaDirectory,
  setDirectoryActiveState,
  cacheAlbums,
  getCachedAlbums,
  isFileInLibrary,
  filterProcessingNeeded,
  setOperationTimeout,
  addTranscodeJob,
  listTranscodeJobs,
  updateTranscodeJobStatus,
  deleteTranscodeJob,
  getPendingTranscodeJobs,
} from '../../src/core/database';

const mocks = vi.hoisted(() => {
  const instance = {
    init: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue([]),
    terminate: vi.fn().mockResolvedValue(undefined),
    setOperationTimeout: vi.fn(),
  };

  class MockWorkerClient {
    constructor() {
      return instance;
    }
  }

  return {
    WorkerClientInstance: instance,
    WorkerClient: MockWorkerClient,
  };
});

vi.mock('../../src/core/worker-client', () => ({
  WorkerClient: mocks.WorkerClient,
}));

describe('database.ts coverage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await initDatabase('/tmp/db', '/tmp/worker.js');
  });

  afterEach(async () => {
    await closeDatabase();
  });

  it('executeSmartPlaylist sends correct message', async () => {
    const criteria = JSON.stringify({ minRating: 5 });
    await executeSmartPlaylist(criteria);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'executeSmartPlaylist',
      { criteria },
    );
  });

  it('executeSmartPlaylist handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await executeSmartPlaylist('{}');
    expect(result).toEqual([]);
  });

  it('getAllMetadataAndStats calls executeSmartPlaylist with empty criteria', async () => {
    await getAllMetadataAndStats();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'executeSmartPlaylist',
      { criteria: '{}' },
    );
  });

  it('getAllMetadataAndStats handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getAllMetadataAndStats();
    expect(result).toEqual([]);
  });

  it('getRecentlyPlayed sends correct message', async () => {
    await getRecentlyPlayed(10);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getRecentlyPlayed',
      { limit: 10 },
    );
  });

  it('getRecentlyPlayed handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(getRecentlyPlayed(10)).rejects.toThrow('Fail');
  });

  it('getPendingMetadata sends correct message', async () => {
    await getPendingMetadata();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getPendingMetadata',
    );
  });

  it('getPendingMetadata handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getPendingMetadata();
    expect(result).toEqual([]);
  });

  it('upsertMetadata sends correct message', async () => {
    const meta = { duration: 100 };
    await upsertMetadata('/path', meta);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'upsertMetadata',
      { filePath: '/path', duration: 100 },
    );
  });

  it('upsertMetadata handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(upsertMetadata('/path', {})).rejects.toThrow('Fail');
  });

  it('getMetadata sends correct message', async () => {
    await getMetadata(['/path']);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getMetadata',
      { filePaths: ['/path'] },
    );
  });

  it('getMetadata handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getMetadata(['/path']);
    expect(result).toEqual({});
  });

  it('setRating sends correct message', async () => {
    await setRating('/path', 5);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'setRating',
      { filePath: '/path', rating: 5 },
    );
  });

  it('setRating handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(setRating('/path', 5)).rejects.toThrow('Fail');
  });

  it('createSmartPlaylist sends correct message', async () => {
    await createSmartPlaylist('Name', '{}');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'createSmartPlaylist',
      { name: 'Name', criteria: '{}' },
    );
  });

  it('createSmartPlaylist validates input', async () => {
    await expect(createSmartPlaylist('', '{}')).rejects.toThrow();
    await expect(createSmartPlaylist('Name', 'invalid')).rejects.toThrow();
  });

  it('createSmartPlaylist handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(createSmartPlaylist('Name', '{}')).rejects.toThrow('Fail');
  });

  it('getSmartPlaylists sends correct message', async () => {
    await getSmartPlaylists();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getSmartPlaylists',
    );
  });

  it('getSmartPlaylists handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getSmartPlaylists();
    expect(result).toEqual([]);
  });

  it('deleteSmartPlaylist sends correct message', async () => {
    await deleteSmartPlaylist(1);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'deleteSmartPlaylist',
      { id: 1 },
    );
  });

  it('deleteSmartPlaylist handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(deleteSmartPlaylist(1)).rejects.toThrow('Fail');
  });

  it('updateSmartPlaylist sends correct message', async () => {
    await updateSmartPlaylist(1, 'Name', '{}');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'updateSmartPlaylist',
      { id: 1, name: 'Name', criteria: '{}' },
    );
  });

  it('updateSmartPlaylist handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(updateSmartPlaylist(1, 'Name', '{}')).rejects.toThrow('Fail');
  });

  it('updateSmartPlaylist validates input', async () => {
    await expect(updateSmartPlaylist(1, '', '{}')).rejects.toThrow();
    await expect(updateSmartPlaylist(1, 'Name', 'invalid')).rejects.toThrow();
  });

  it('updateWatchedSegments sends correct message', async () => {
    await updateWatchedSegments('/path', '[]');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'updateWatchedSegments',
      { filePath: '/path', segmentsJson: '[]' },
    );
  });

  it('updateWatchedSegments handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await updateWatchedSegments('/path', '[]');
    // It catches error and logs safeError
  });

  it('saveSetting sends correct message', async () => {
    await saveSetting('key', 'value');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'saveSetting',
      { key: 'key', value: 'value' },
    );
  });

  it('saveSetting handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(saveSetting('key', 'value')).rejects.toThrow('Fail');
  });

  it('getSetting sends correct message', async () => {
    await getSetting('key');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getSetting',
      { key: 'key' },
    );
  });

  it('getSetting handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getSetting('key');
    expect(result).toBeNull();
  });

  it('recordMediaView sends correct message', async () => {
    await recordMediaView('/path');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'recordMediaView',
      { filePath: '/path' },
    );
  });

  it('recordMediaView handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await recordMediaView('/path');
    // logs warning
  });

  it('getMediaViewCounts sends correct message', async () => {
    await getMediaViewCounts(['/path']);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getMediaViewCounts',
      { filePaths: ['/path'] },
    );
  });

  it('getMediaViewCounts handles empty list', async () => {
    const result = await getMediaViewCounts([]);
    expect(result).toEqual({});
    expect(mocks.WorkerClientInstance.sendMessage).not.toHaveBeenCalled();
  });

  it('getMediaViewCounts handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getMediaViewCounts(['/path']);
    expect(result).toEqual({});
  });

  it('addMediaDirectory sends correct message', async () => {
    await addMediaDirectory('/path');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'addMediaDirectory',
      { directoryObj: { path: '/path' } },
    );
  });

  it('addMediaDirectory handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(addMediaDirectory('/path')).rejects.toThrow('Fail');
  });

  it('getMediaDirectories sends correct message', async () => {
    mocks.WorkerClientInstance.sendMessage.mockResolvedValueOnce([
      { path: '/path' },
    ]);
    await getMediaDirectories();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getMediaDirectories',
    );
  });

  it('getMediaDirectories handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getMediaDirectories();
    expect(result).toEqual([]);
  });

  it('removeMediaDirectory sends correct message', async () => {
    await removeMediaDirectory('/path');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'removeMediaDirectory',
      { directoryPath: '/path' },
    );
  });

  it('removeMediaDirectory handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(removeMediaDirectory('/path')).rejects.toThrow('Fail');
  });

  it('setDirectoryActiveState sends correct message', async () => {
    await setDirectoryActiveState('/path', true);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'setDirectoryActiveState',
      { directoryPath: '/path', isActive: true },
    );
  });

  it('setDirectoryActiveState handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await expect(setDirectoryActiveState('/path', true)).rejects.toThrow(
      'Fail',
    );
  });

  it('cacheAlbums sends correct message', async () => {
    await cacheAlbums([]);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'cacheAlbums',
      expect.objectContaining({ albums: [] }),
    );
  });

  it('cacheAlbums handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    await cacheAlbums([]);
    // logs error
  });

  it('getCachedAlbums sends correct message', async () => {
    await getCachedAlbums();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getCachedAlbums',
      expect.any(Object),
    );
  });

  it('getCachedAlbums handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await getCachedAlbums();
    expect(result).toBeNull();
  });

  it('isFileInLibrary returns true if file exists', async () => {
    mocks.WorkerClientInstance.sendMessage.mockResolvedValueOnce({
      '/path': { filePath: '/path' },
    });
    const result = await isFileInLibrary('/path');
    expect(result).toBe(true);
  });

  it('isFileInLibrary handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await isFileInLibrary('/path');
    expect(result).toBe(false);
  });

  it('filterProcessingNeeded sends correct message', async () => {
    await filterProcessingNeeded(['/path']);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'filterProcessingNeeded',
      { filePaths: ['/path'] },
    );
  });

  it('filterProcessingNeeded handles error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Fail'),
    );
    const result = await filterProcessingNeeded(['/path']);
    expect(result).toEqual(['/path']);
  });

  it('setOperationTimeout calls client method', async () => {
    setOperationTimeout(1000);
    expect(mocks.WorkerClientInstance.setOperationTimeout).toHaveBeenCalledWith(
      1000,
    );
  });

  it('returns empty if worker not initialized', async () => {
    await closeDatabase();
    // getClient() throws, but getAllMetadataAndStats catches it
    const result = await getAllMetadataAndStats();
    expect(result).toEqual([]);
  });

  it('addTranscodeJob sends correct message', async () => {
    await addTranscodeJob('/video.mp4');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'addTranscodeJob',
      { filePath: '/video.mp4' },
    );
  });

  it('listTranscodeJobs sends correct message', async () => {
    mocks.WorkerClientInstance.sendMessage.mockResolvedValueOnce([]);
    const result = await listTranscodeJobs();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'listTranscodeJobs',
    );
    expect(result).toEqual([]);
  });

  it('listTranscodeJobs returns empty on error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('DB fail'),
    );
    const result = await listTranscodeJobs();
    expect(result).toEqual([]);
  });

  it('updateTranscodeJobStatus sends correct message', async () => {
    await updateTranscodeJobStatus('/video.mp4', 'done', null);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'updateTranscodeJobStatus',
      { filePath: '/video.mp4', status: 'done', error: null },
    );
  });

  it('deleteTranscodeJob sends correct message', async () => {
    await deleteTranscodeJob('/video.mp4');
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'deleteTranscodeJob',
      { filePath: '/video.mp4' },
    );
  });

  it('getPendingTranscodeJobs sends correct message', async () => {
    mocks.WorkerClientInstance.sendMessage.mockResolvedValueOnce(['/a.mp4']);
    const result = await getPendingTranscodeJobs();
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'getPendingTranscodeJobs',
    );
    expect(result).toEqual(['/a.mp4']);
  });

  it('getPendingTranscodeJobs returns empty on error', async () => {
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('fail'),
    );
    const result = await getPendingTranscodeJobs();
    expect(result).toEqual([]);
  });
});
