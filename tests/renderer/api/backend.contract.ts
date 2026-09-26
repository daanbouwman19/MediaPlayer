import { describe, it, expect, beforeEach, vi } from 'vite-plus/test';
import { IMediaBackend } from '../../../src/renderer/api/types';

export interface ContractTestOptions {
  supportsVlc: boolean;
}

export function runBackendContractTests(
  adapterName: string,
  createAdapter: () => IMediaBackend,
  primeBackend: (method: string, result?: any, error?: any) => void,
  options: ContractTestOptions,
) {
  describe(`Shared Contract: ${adapterName}`, () => {
    let backend: IMediaBackend;

    beforeEach(() => {
      backend = createAdapter();
    });

    describe('Media Loading', () => {
      it('should load file as data url', async () => {
        const mockResult = { type: 'data-url' as const, url: 'data:...' };
        primeBackend('loadFileAsDataURL', mockResult);
        const result = await backend.loadFileAsDataURL('test.jpg');
        // WebAdapter might return http-url always, ElectronAdapter might return data-url
        // We just assert it returns a valid LoadResult structure
        expect(result).toHaveProperty('type');
        if (adapterName === 'WebAdapter') {
          expect(result.type).toBe('http-url');
        } else {
          // For Electron, it returns whatever we mocked
          expect(result).toEqual(mockResult);
        }
      });
    });

    describe('Media Views', () => {
      it('should record media view', async () => {
        primeBackend('recordMediaView', undefined);
        await backend.recordMediaView('test.jpg');
        // We can't easily assert *what* was called without exposing spies,
        // but we verify it resolves successfully.
      });

      it('should get media view counts', async () => {
        const counts = { 'test.jpg': 5 };
        primeBackend('getMediaViewCounts', counts);
        const result = await backend.getMediaViewCounts(['test.jpg']);
        expect(result).toEqual(counts);
      });
    });

    describe('Albums', () => {
      it('should get albums with view counts', async () => {
        const albums = [{ id: '1', title: 'Test Album' }];
        primeBackend('getAlbumsWithViewCounts', albums);
        const result = await backend.getAlbumsWithViewCounts();
        expect(result).toEqual(albums);
      });

      it('should reindex media library', async () => {
        const albums = [{ id: '1', title: 'New Album' }];
        primeBackend('reindexMediaLibrary', albums);
        const result = await backend.reindexMediaLibrary();
        expect(result).toEqual(albums);
      });
    });

    describe('Directories', () => {
      it('should add media directory', async () => {
        primeBackend('addMediaDirectory', '/path');
        const result = await backend.addMediaDirectory('/path');
        expect(result).toBe('/path');
      });

      it('should remove media directory', async () => {
        primeBackend('removeMediaDirectory', undefined);
        await backend.removeMediaDirectory('/path');
      });

      it('should set directory active state', async () => {
        primeBackend('setDirectoryActiveState', undefined);
        await backend.setDirectoryActiveState('/path', true);
      });

      it('should get media directories', async () => {
        const dirs = [{ path: '/path', isActive: true }];
        primeBackend('getMediaDirectories', dirs);
        const result = await backend.getMediaDirectories();
        expect(result).toEqual(dirs);
      });
    });

    describe('Config & Utilities', () => {
      it('should get supported extensions', async () => {
        const exts = { images: ['jpg'], videos: ['mp4'], all: ['jpg', 'mp4'] };
        primeBackend('getSupportedExtensions', exts);
        const result = await backend.getSupportedExtensions();
        expect(result).toEqual(exts);
      });

      it('should get server port', async () => {
        primeBackend('getServerPort', 1234);
        const result = await backend.getServerPort();
        expect(result).toBe(1234);
      });
    });

    describe('Metadata', () => {
      it('should get video metadata', async () => {
        primeBackend('getVideoMetadata', { duration: 120 });
        const result = await backend.getVideoMetadata('video.mp4');
        expect(result).toEqual({ duration: 120 });
      });

      it('should handle video metadata error/empty', async () => {
        primeBackend('getVideoMetadata', {}, 'Failed');
        await expect(backend.getVideoMetadata('bad.mp4')).rejects.toThrow();
      });

      it('should upsert metadata', async () => {
        primeBackend('upsertMetadata', undefined);
        await backend.upsertMetadata('file.jpg', { rating: 5 });
      });

      it('should get metadata batch', async () => {
        const meta = { 'file.jpg': { rating: 5 } };
        primeBackend('getMetadata', meta);
        const result = await backend.getMetadata(['file.jpg']);
        expect(result).toEqual(meta);
      });

      it('should set rating', async () => {
        primeBackend('setRating', undefined);
        await backend.setRating('file.jpg', 4);
      });

      it('should get all metadata and stats', async () => {
        primeBackend('getAllMetadataAndStats', []);
        const result = await backend.getAllMetadataAndStats();
        expect(result).toEqual([]);
      });

      it('should extract metadata', async () => {
        primeBackend('extractMetadata', undefined);
        await backend.extractMetadata(['file.mp4']);
      });
    });

    describe('File System', () => {
      it('should list directory', async () => {
        const entries = [{ name: 'test', isDirectory: false }];
        primeBackend('listDirectory', entries);
        const result = await backend.listDirectory('/path');
        expect(result).toEqual(entries);
      });

      it('should get parent directory', async () => {
        primeBackend('getParentDirectory', '/parent');
        const result = await backend.getParentDirectory('/parent/child');
        expect(result).toBe('/parent');
      });
    });

    describe('Smart Playlists', () => {
      it('should create smart playlist', async () => {
        primeBackend('createSmartPlaylist', { id: 1 });
        const result = await backend.createSmartPlaylist('List', '{}');
        expect(result).toEqual({ id: 1 });
      });

      it('should get smart playlists', async () => {
        const playlists = [{ id: 1, name: 'List' }];
        primeBackend('getSmartPlaylists', playlists);
        const result = await backend.getSmartPlaylists();
        expect(result).toEqual(playlists);
      });

      it('should update smart playlist', async () => {
        primeBackend('updateSmartPlaylist', undefined);
        await backend.updateSmartPlaylist(1, 'Name', '{}');
      });

      it('should delete smart playlist', async () => {
        primeBackend('deleteSmartPlaylist', undefined);
        await backend.deleteSmartPlaylist(1);
      });
    });

    describe('Google Drive', () => {
      it('should start auth flow', async () => {
        primeBackend('startGoogleDriveAuth', 'http://auth.url');
        if (adapterName === 'ElectronAdapter') {
          primeBackend('openExternal', undefined);
        }
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

        const url = await backend.startGoogleDriveAuth();
        expect(url).toBe('http://auth.url');

        const maybeAdapter = backend as unknown as {
          bridge?: { openExternal?: ReturnType<typeof vi.fn> };
        };

        if (adapterName === 'ElectronAdapter' && maybeAdapter.bridge) {
          expect(maybeAdapter.bridge.openExternal).toHaveBeenCalledWith(
            'http://auth.url',
          );
          expect(openSpy).not.toHaveBeenCalled();
        } else {
          expect(openSpy).toHaveBeenCalledWith('http://auth.url', '_blank');
        }

        openSpy.mockRestore();
      });

      it('should submit auth code', async () => {
        primeBackend('submitGoogleDriveAuthCode', true);
        const result = await backend.submitGoogleDriveAuthCode('code');
        expect(result).toBe(true);
      });

      it('should add drive source', async () => {
        primeBackend('addGoogleDriveSource', { name: 'Drive' });
        const result = await backend.addGoogleDriveSource('folderId');
        expect(result).toEqual({ name: 'Drive' });
      });

      it('should list drive directory', async () => {
        primeBackend('listGoogleDriveDirectory', []);
        const result = await backend.listGoogleDriveDirectory('folderId');
        expect(result).toEqual([]);
      });

      it('should get drive parent', async () => {
        primeBackend('getGoogleDriveParent', 'parentId');
        const result = await backend.getGoogleDriveParent('childId');
        expect(result).toBe('parentId');
      });
    });

    describe('VLC Support', () => {
      if (options.supportsVlc) {
        it('should open in VLC successfully', async () => {
          primeBackend('openInVlc', { success: true });
          const result = await backend.openInVlc('/file.mp4');
          expect(result).toEqual({ success: true });
        });
      } else {
        it('should return not supported', async () => {
          // For Web, checking implementation
          const result = await backend.openInVlc('/file.mp4');
          expect(result.success).toBe(false);
          expect(result.message).toContain('Not supported');
        });
      }
    });

    describe('URL Generators', () => {
      // These are client-side mostly, but depend on server port
      it('should generate media URLs', async () => {
        primeBackend('getServerPort', 3000);

        const mediaGen = await backend.getMediaUrlGenerator();
        // We assert flexible format because encoding might vary slightly
        // or implementation details (Web vs Electron use different base)
        // Web: /api/serve...
        // Electron: http://localhost:3000/...
        // The primeBackend('getServerPort') is mainly for ElectronAdapter or WebAdapter logic that uses it.

        expect(mediaGen('test.jpg')).toBeTruthy();

        const thumbGen = await backend.getThumbnailUrlGenerator();
        expect(thumbGen('test.jpg')).toBeTruthy();

        const videoGen = await backend.getVideoStreamUrlGenerator();
        expect(videoGen('test.mp4')).toBeTruthy();
      });
    });
  });
}
