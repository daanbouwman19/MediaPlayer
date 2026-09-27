import { EventEmitter } from 'events';
import { vi, type Mock } from 'vite-plus/test';

// Define types for mock data
export interface MockAlbum {
  id: string;
  name: string;
  textures: { name: string; path: string }[];
  children: MockAlbum[];
}

export interface MockDirectory {
  path: string;
  isActive: boolean;
}

export interface MockDB {
  views: Record<string, number>;
  albums: MockAlbum[];
  albumsCached: boolean;
  directories: MockDirectory[];
}

// Store data in mock to simulate DB
export const mockDb: MockDB = {
  views: {},
  albums: [],
  albumsCached: false,
  directories: [],
};

// Module-scoped variable to hold the latest mock worker instance
export let mockWorkerInstance: MockWorker | null = null;

export function setMockWorkerInstance(instance: MockWorker | null) {
  mockWorkerInstance = instance;
}

export class MockWorker extends EventEmitter {
  terminate: Mock;
  postMessage: Mock;

  constructor() {
    super();
    this.terminate = vi.fn().mockResolvedValue(undefined);

    this.postMessage = vi.fn(
      (message: { id: string; type: string; payload: any }) => {
        const { id, type, payload } = message;
        let resultData: unknown = undefined;
        const success = true;

        if (type === 'init') {
          // success
        } else if (type === 'recordMediaView') {
          const filePath = payload.filePath;
          mockDb.views[filePath] = (mockDb.views[filePath] || 0) + 1;
        } else if (type === 'getMediaViewCounts') {
          const paths = payload.filePaths;
          const counts: Record<string, number> = {};
          paths.forEach((p: string) => {
            counts[p] = mockDb.views[p] || 0;
          });
          resultData = counts;
        } else if (type === 'cacheAlbums') {
          mockDb.albums = payload.albums;
          mockDb.albumsCached = true;
        } else if (type === 'getCachedAlbums') {
          // Return null only when there are no cached albums (initial state)
          // Return the actual array (even if empty) if cacheAlbums was called
          resultData = mockDb.albumsCached ? mockDb.albums : null;
        } else if (type === 'addMediaDirectory') {
          const dirObj = payload.directoryObj;
          const dirPath = typeof dirObj === 'string' ? dirObj : dirObj.path;
          mockDb.directories.push({
            path: dirPath,
            isActive: true,
          });
        } else if (type === 'getMediaDirectories') {
          resultData = mockDb.directories;
        } else if (type === 'removeMediaDirectory') {
          mockDb.directories = mockDb.directories.filter(
            (d: MockDirectory) => d.path !== payload.directoryPath,
          );
        } else if (type === 'setDirectoryActiveState') {
          const dir = mockDb.directories.find(
            (d: MockDirectory) => d.path === payload.directoryPath,
          );
          if (dir) dir.isActive = payload.isActive;
        } else if (type === 'close') {
          // success
        }

        // Simulate async response
        process.nextTick(() => {
          this.emit('message', {
            id: id,
            result: { success, data: resultData },
          });
        });
      },
    );
    setMockWorkerInstance(this);
  }

  // Helper methods
  simulateMessage(message: unknown) {
    this.emit('message', message);
  }

  simulateError(error: unknown) {
    this.emit('error', error);
  }

  simulateExit(code: number) {
    this.emit('exit', code);
  }
}

export function resetMockWorker() {
  setMockWorkerInstance(null);
  mockDb.views = {};
  mockDb.albums = [];
  mockDb.albumsCached = false;
  mockDb.directories = [];
}
