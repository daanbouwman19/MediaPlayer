import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { registerMediaHandlers } from '../../src/main/ipc/media-controller';
import { createTestMediaService } from '../utils/test-factory';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

// Mock dependencies
vi.mock('fs/promises', () => ({
  default: {
    access: vi.fn(),
    stat: vi.fn(),
    readFile: vi.fn(),
    realpath: vi.fn(),
  },
}));

// Mock ipc-helper to capture handlers
const { handlers } = vi.hoisted(() => ({ handlers: new Map() }));
vi.mock('../../src/main/utils/ipc-helper', () => ({
  handleIpc: vi.fn((channel, handler) => {
    handlers.set(channel, handler);
  }),
}));

vi.mock('../../src/main/local-server', () => ({
  getServerPort: vi.fn().mockReturnValue(0),
}));

// Also mock core/database because src/core/security.ts imports directly from it
vi.mock('../../src/core/database/database', () => ({
  isFileInLibrary: vi.fn(),
  getMediaDirectories: vi.fn(),
  recordMediaView: vi.fn(),
  getMediaViewCounts: vi.fn(),
  getRecentlyPlayed: vi.fn(),
}));

// We need to mock other dependencies of media-controller that we aren't testing to avoid errors
vi.mock('../../src/main/google-drive-service', () => ({
  getDriveFileMetadata: vi.fn(),
  listDriveDirectory: vi.fn(),
  getDriveParent: vi.fn(),
}));

describe('Media Controller IPC Handlers', () => {
  let handler: (event: any, ...args: any[]) => any;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers.clear();

    const dbCore = await import('../../src/core/database/database');

    const mockDirectories = [{ path: '/path/to', isActive: true }];
    (dbCore.getMediaDirectories as unknown as Mock).mockResolvedValue(
      mockDirectories,
    );

    // Register handlers
    const { service } = createTestMediaService();
    registerMediaHandlers(service);

    // Get the handler
    handler = handlers.get(IPC_CHANNELS.LOAD_FILE_AS_DATA_URL);
  });

  it('should return a generic error for a non-existent file (security)', async () => {
    expect(handler).toBeDefined();

    const nonExistentPath = '/path/to/nothing.txt';
    const fsPromises = await import('fs/promises');
    const expectedError = new Error('ENOENT');
    (expectedError as any).code = 'ENOENT';
    (fsPromises.default.realpath as unknown as Mock).mockRejectedValue(
      expectedError,
    );

    const result = await handler(null, nonExistentPath);

    // media-controller returns the result of generateFileUrl directly
    expect(result).toMatchObject({
      type: 'error',
      message: 'Access denied',
    });

    expect(fsPromises.default.realpath).toHaveBeenCalled();
  });
});
