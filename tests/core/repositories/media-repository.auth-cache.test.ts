import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { MediaRepository } from '../../../src/core/database/repositories/media-repository';
import {
  initDatabase,
  closeDatabase,
} from '../../../src/core/database/database';
import * as security from '../../../src/core/auth/security';

const mocks = vi.hoisted(() => {
  const instance = {
    init: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    terminate: vi.fn().mockResolvedValue(undefined),
    setOperationTimeout: vi.fn(),
  };

  class MockWorkerClient {
    constructor() {
      return instance;
    }
  }

  return { WorkerClientInstance: instance, WorkerClient: MockWorkerClient };
});

vi.mock('../../../src/core/database/worker-client', () => ({
  WorkerClient: mocks.WorkerClient,
}));

// The album cache write also records library membership, which authorizes
// gdrive:// paths, so the repository used by scans must invalidate the auth
// cache whether or not the write succeeds.
describe('MediaRepository.cacheAlbums auth-cache invalidation', () => {
  const repo = new MediaRepository();

  beforeEach(async () => {
    vi.clearAllMocks();
    await initDatabase('/tmp/db', '/tmp/worker.js');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeDatabase();
  });

  it('writes the album cache and invalidates the auth cache on success', async () => {
    const spy = vi.spyOn(security, 'clearAuthCache');
    await repo.cacheAlbums([]);
    expect(mocks.WorkerClientInstance.sendMessage).toHaveBeenCalledWith(
      'cacheAlbums',
      expect.objectContaining({ albums: [] }),
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rethrows and still invalidates the auth cache on failure', async () => {
    const spy = vi.spyOn(security, 'clearAuthCache');
    mocks.WorkerClientInstance.sendMessage.mockRejectedValueOnce(
      new Error('Operation timed out'),
    );
    await expect(repo.cacheAlbums([])).rejects.toThrow('Operation timed out');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
