import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockElectron } from './mocks/electron';

// Hoist the control variable so it can be used in the hoisted vi.mock factory
const mocks = vi.hoisted(() => ({
  workerShouldThrow: false,
}));

// Mock worker_threads globally for this file
vi.mock('worker_threads', () => {
  class MockWorker {
    listeners: Record<string, ((message: any) => void)[]> = {};

    constructor() {
      if (mocks.workerShouldThrow) {
        throw new Error('Worker construction failed');
      }
    }

    on(event: string, cb: (message: any) => void) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(cb);
    }

    postMessage(msg: any) {
      // During initDatabase, the module sends an 'init' message — reply with success
      if (msg && msg.type === 'init') {
        // simulate async worker response
        setTimeout(() => {
          const cbs = this.listeners['message'];
          if (cbs) {
            cbs.forEach((cb) =>
              cb({
                id: msg.id,
                result: { success: true, data: {} },
              }),
            );
          }
        }, 0);
        return;
      }

      // For any other message type, simulate a postMessage failure
      throw new Error('postMessage failed');
    }

    async terminate() {
      return;
    }
  }

  return { Worker: MockWorker, default: { Worker: MockWorker } };
});

describe('Database error handling (isolated)', () => {
  beforeEach(() => {
    // Ensure a clean module cache for each test
    vi.resetModules();
    vi.doMock('electron', () => createMockElectron());

    // Reset the mock behavior state
    mocks.workerShouldThrow = false;
  });

  it('initDatabase throws when Worker constructor throws', async () => {
    // Arrange
    mocks.workerShouldThrow = true;
    const dbMain = await import('../../src/main/database.js');

    // Act & Assert
    await expect(dbMain.initDatabase()).rejects.toThrow(
      'Worker construction failed',
    );
  });

  describe('when worker is initialized but fails messages', () => {
    it('recordMediaView handles worker failure gracefully', async () => {
      // Arrange
      const dbMain = await import('../../src/main/database.js');
      const dbCore = await import('../../src/core/database/database.js');
      await dbMain.initDatabase();

      // Act & Assert
      // recordMediaView should swallow errors (not throw)
      await expect(
        dbCore.recordMediaView('/some/file.png'),
      ).resolves.toBeUndefined();

      // Cleanup
      await dbCore.closeDatabase();
    });

    it('getMediaViewCounts returns empty object on worker failure', async () => {
      // Arrange
      const dbMain = await import('../../src/main/database.js');
      const dbCore = await import('../../src/core/database/database.js');
      await dbMain.initDatabase();

      // Act
      const counts = await dbCore.getMediaViewCounts(['/some/file.png']);

      // Assert
      expect(counts).toEqual({});

      // Cleanup
      await dbCore.closeDatabase();
    });
  });
});
