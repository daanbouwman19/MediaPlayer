import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import {
  MediaService,
  ALBUM_CACHE_STAMP_KEY,
  EMPTY_ALBUM_CACHE_TTL_MS,
} from '../../src/core/media/media-service';
import { InMemoryMediaRepository } from '../fakes/in-memory-media-repository';
import type { Album, MediaDirectory } from '../../src/core/media/types';

const local = (p: string, isActive = true): MediaDirectory => ({
  id: p,
  path: p,
  type: 'local',
  name: p,
  isActive,
});

const album = (id: string, paths: string[]): Album => ({
  id,
  name: id,
  textures: paths.map((p) => ({ name: p.split('/').pop()!, path: p })),
  children: [],
});

/** A promise that the test resolves by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('MediaService library cache and scans', () => {
  let repo: InMemoryMediaRepository;
  let runScan: ReturnType<typeof vi.fn>;
  let getVideoDuration: ReturnType<typeof vi.fn>;
  let getFileMetadata: ReturnType<typeof vi.fn>;
  let stat: ReturnType<typeof vi.fn>;
  let service: MediaService;

  beforeEach(() => {
    repo = new InMemoryMediaRepository();
    runScan = vi.fn().mockResolvedValue([]);
    getVideoDuration = vi.fn().mockResolvedValue({ duration: 60 });
    getFileMetadata = vi.fn();
    stat = vi.fn().mockResolvedValue({
      size: 1000,
      birthtime: new Date('2024-01-01T00:00:00.000Z'),
    });
    service = new MediaService(
      repo,
      { stat } as any,
      { runScan } as any,
      { getVideoDuration, getFileMetadata } as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('F90: a failed source read is not "no sources"', () => {
    it('aborts the scan and leaves the cache alone', async () => {
      await repo.cacheAlbums([album('/media', ['/media/a.jpg'])]);
      vi.spyOn(repo, 'getMediaDirectories').mockRejectedValue(
        new Error('Worker not initialized'),
      );
      const cacheSpy = vi.spyOn(repo, 'cacheAlbums');

      await expect(service.scanDiskForAlbumsAndCache()).rejects.toThrow(
        'Worker not initialized',
      );
      await expect(service.getAlbumsWithViewCountsAfterScan()).rejects.toThrow(
        'Worker not initialized',
      );
      expect(cacheSpy).not.toHaveBeenCalled();
      expect(runScan).not.toHaveBeenCalled();
    });

    it('serves the cached tree when the sources cannot be read', async () => {
      const cached = [album('/media', ['/media/a.jpg'])];
      await repo.cacheAlbums(cached);
      vi.spyOn(repo, 'getMediaDirectories').mockRejectedValue(
        new Error('timeout'),
      );
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(service.getAlbumsFromCacheOrDisk()).resolves.toBe(cached);
      expect(runScan).not.toHaveBeenCalled();
    });
  });

  describe('F39: the cache follows the configured sources', () => {
    beforeEach(async () => {
      repo.setMediaDirectories([local('/media'), local('/other')]);
      runScan.mockResolvedValue([album('/media', ['/media/a.jpg'])]);
      await service.scanDiskForAlbumsAndCache();
      runScan.mockClear();
    });

    it('serves the cache while the sources are unchanged (in any order)', async () => {
      repo.setMediaDirectories([local('/other'), local('/media')]);
      const albums = await service.getAlbumsWithViewCounts();
      expect(albums[0]!.id).toBe('/media');
      expect(runScan).not.toHaveBeenCalled();
    });

    it.each([
      ['a source was removed', [local('/media')]],
      ['a source was added', [local('/media'), local('/other'), local('/new')]],
      ['a source was deactivated', [local('/media'), local('/other', false)]],
    ])('rescans when %s', async (_label, directories) => {
      repo.setMediaDirectories(directories);
      runScan.mockResolvedValue([album('/media', ['/media/b.jpg'])]);

      const albums = await service.getAlbumsWithViewCounts();

      expect(runScan).toHaveBeenCalledTimes(1);
      expect(albums[0]!.textures[0]!.path).toBe('/media/b.jpg');
      // ...and the fresh tree is served from cache afterwards.
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);
    });

    it('rescans a legacy cache that has no source stamp once', async () => {
      const staleTree = [album('/removed', ['/removed/x.jpg'])];
      await repo.cacheAlbums(staleTree);
      await repo.saveSetting(ALBUM_CACHE_STAMP_KEY, '');

      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);
    });

    it('treats a corrupt stamp as missing', async () => {
      await repo.saveSetting(ALBUM_CACHE_STAMP_KEY, '{not json');
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);

      await repo.saveSetting(ALBUM_CACHE_STAMP_KEY, '{"sources":1}');
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(2);
    });

    it('rescans after a failed cache write instead of serving the old tree', async () => {
      // /other is removed; the tree cached for /media + /other is stale.
      repo.setMediaDirectories([local('/media')]);
      runScan.mockResolvedValue([album('/media', ['/media/b.jpg'])]);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      // e.g. the worker's 30 s operation timeout on a big first scan
      vi.spyOn(repo, 'cacheAlbums').mockRejectedValueOnce(
        new Error('Operation timed out'),
      );

      // The scan fails: the tree that could not be stored is not served...
      await expect(service.getAlbumsWithViewCounts()).rejects.toThrow(
        'Operation timed out',
      );
      expect(error).toHaveBeenCalledWith(
        '[media-service] Failed to cache albums; the next read rescans:',
        expect.any(Error),
      );
      // ...but the old tree it failed to replace is not stamped as current.
      expect(await repo.getSetting(ALBUM_CACHE_STAMP_KEY)).toBeNull();
      expect((await repo.getCachedAlbums())![0]!.textures[0]!.path).toBe(
        '/media/a.jpg',
      );

      const next = await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(2);
      expect(next[0]!.textures[0]!.path).toBe('/media/b.jpg');
      // Once the tree is stored, it is served from cache again.
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(2);
    });

    it('F92: fails the scan and skips extraction when the membership write rolls back', async () => {
      runScan.mockResolvedValue([album('/media', ['/media/new.mp4'])]);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(repo, 'cacheAlbums').mockRejectedValue(
        new Error('SQLITE_BUSY: database is locked'),
      );
      const extract = vi.spyOn(service, 'queueMetadataExtraction');

      await expect(
        service.scanDiskForAlbumsAndCache('/ffmpeg'),
      ).rejects.toThrow('SQLITE_BUSY');
      await expect(
        service.getAlbumsWithViewCountsAfterScan('/ffmpeg'),
      ).rejects.toThrow();
      expect(extract).not.toHaveBeenCalled();
      // The previously stored tree is untouched.
      expect((await repo.getCachedAlbums())![0]!.textures[0]!.path).toBe(
        '/media/a.jpg',
      );
    });

    it('clears the stamp before writing the tree', async () => {
      const write = deferred<void>();
      const cacheSpy = vi
        .spyOn(repo, 'cacheAlbums')
        .mockReturnValueOnce(write.promise);
      runScan.mockResolvedValue([album('/media', ['/media/b.jpg'])]);

      const scan = service.scanDiskForAlbumsAndCache();
      await vi.waitFor(() => expect(cacheSpy).toHaveBeenCalled());
      // Were the app to quit mid-write, the old tree would not look current.
      expect(await repo.getSetting(ALBUM_CACHE_STAMP_KEY)).toBeNull();

      write.resolve();
      await scan;
      expect(await repo.getSetting(ALBUM_CACHE_STAMP_KEY)).toContain('/media');
    });

    it('still caches the tree when the old stamp cannot be cleared', async () => {
      vi.spyOn(repo, 'saveSetting').mockRejectedValueOnce(new Error('busy'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      runScan.mockResolvedValue([album('/media', ['/media/b.jpg'])]);

      await service.scanDiskForAlbumsAndCache();

      expect(warn).toHaveBeenCalledWith(
        '[media-service] Failed to clear the album cache stamp:',
        expect.any(Error),
      );
      expect((await repo.getCachedAlbums())![0]!.textures[0]!.path).toBe(
        '/media/b.jpg',
      );
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);
    });

    it('still works when the stamp cannot be saved', async () => {
      vi.spyOn(repo, 'saveSetting').mockRejectedValue(new Error('busy'));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      repo.setMediaDirectories([local('/media')]);

      await expect(service.getAlbumsWithViewCounts()).resolves.toHaveLength(1);
      expect(warn).toHaveBeenCalledWith(
        '[media-service] Failed to stamp the album cache:',
        expect.any(Error),
      );
    });
  });

  describe('F97: an empty scan result is cached', () => {
    beforeEach(() => {
      repo.setMediaDirectories([local('/mnt/nas')]); // unmounted: finds nothing
      runScan.mockResolvedValue([]);
    });

    it('does not rescan on every read', async () => {
      expect(await service.getAlbumsWithViewCounts()).toEqual([]);
      expect(await service.getAlbumsWithViewCounts()).toEqual([]);
      expect(await service.getAlbumsFromCacheOrDisk()).toEqual([]);
      expect(runScan).toHaveBeenCalledTimes(1);
    });

    it('rescans once the empty result is older than the TTL', async () => {
      const now = Date.now();
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(now + EMPTY_ALBUM_CACHE_TTL_MS - 1);
      await service.getAlbumsWithViewCounts();
      expect(runScan).toHaveBeenCalledTimes(1);

      clock.mockReturnValue(now + EMPTY_ALBUM_CACHE_TTL_MS);
      runScan.mockResolvedValue([album('/mnt/nas', ['/mnt/nas/a.jpg'])]);
      expect(await service.getAlbumsWithViewCounts()).toHaveLength(1);
      expect(runScan).toHaveBeenCalledTimes(2);
    });
  });

  describe('F94: single-flight scans', () => {
    it('shares one scan between concurrent callers', async () => {
      repo.setMediaDirectories([local('/media')]);
      const scan = deferred<Album[]>();
      runScan.mockReturnValue(scan.promise);

      const first = service.getAlbumsWithViewCountsAfterScan();
      const second = service.scanDiskForAlbumsAndCache();
      const third = service.getAlbumsWithViewCounts(); // empty cache
      await vi.waitFor(() => expect(runScan).toHaveBeenCalledTimes(1));

      scan.resolve([album('/media', ['/media/a.jpg'])]);
      const results = await Promise.all([first, second, third]);

      expect(runScan).toHaveBeenCalledTimes(1);
      for (const result of results) {
        expect(result[0]!.id).toBe('/media');
      }
    });

    it('rescans after an outdated scan instead of letting it win', async () => {
      repo.setMediaDirectories([local('/media')]);
      const oldScan = deferred<Album[]>();
      runScan.mockReturnValueOnce(oldScan.promise);
      const stale = service.scanDiskForAlbumsAndCache();
      await vi.waitFor(() => expect(runScan).toHaveBeenCalledTimes(1));

      // A folder is added while the old scan is still running.
      repo.setMediaDirectories([local('/media'), local('/new')]);
      runScan.mockResolvedValueOnce([
        album('/media', ['/media/a.jpg']),
        album('/new', ['/new/b.jpg']),
      ]);
      const fresh = service.scanDiskForAlbumsAndCache();

      // The new scan waits for the old one rather than running alongside it.
      await Promise.resolve();
      expect(runScan).toHaveBeenCalledTimes(1);

      oldScan.resolve([album('/media', ['/media/a.jpg'])]);
      await expect(stale).resolves.toHaveLength(1);
      await expect(fresh).resolves.toHaveLength(2);

      expect(runScan).toHaveBeenCalledTimes(2);
      expect(runScan).toHaveBeenLastCalledWith({
        directories: ['/media', '/new'],
        tokens: null,
      });
      expect(await repo.getCachedAlbums()).toHaveLength(2);
    });

    it('starts a new scan after a failed one', async () => {
      repo.setMediaDirectories([local('/media')]);
      runScan.mockRejectedValueOnce(new Error('worker crashed'));
      await expect(service.scanDiskForAlbumsAndCache()).rejects.toThrow(
        'worker crashed',
      );

      runScan.mockResolvedValueOnce([album('/media', ['/media/a.jpg'])]);
      await expect(service.scanDiskForAlbumsAndCache()).resolves.toHaveLength(
        1,
      );
    });

    it('a changed-sources caller also recovers from a failing older scan', async () => {
      repo.setMediaDirectories([local('/media')]);
      const oldScan = deferred<Album[]>();
      runScan.mockReturnValueOnce(oldScan.promise);
      const stale = service.scanDiskForAlbumsAndCache();
      await vi.waitFor(() => expect(runScan).toHaveBeenCalledTimes(1));

      repo.setMediaDirectories([local('/other')]);
      runScan.mockResolvedValueOnce([album('/other', ['/other/a.jpg'])]);
      const fresh = service.scanDiskForAlbumsAndCache();

      oldScan.reject(new Error('old scan failed'));
      await expect(stale).rejects.toThrow('old scan failed');
      await expect(fresh).resolves.toHaveLength(1);
    });

    it('runs one metadata extraction at a time and picks up queued files', async () => {
      repo.setMediaDirectories([local('/media')]);
      const firstRun = deferred<void>();
      const extract = vi
        .spyOn(service, 'extractAndSaveMetadata')
        .mockReturnValueOnce(firstRun.promise)
        .mockResolvedValue(undefined);

      runScan.mockResolvedValueOnce([album('/media', ['/media/a.mp4'])]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));

      // Two more scans finish while the first extraction is still running.
      runScan.mockResolvedValueOnce([album('/media', ['/media/b.mp4'])]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      runScan.mockResolvedValueOnce([album('/media', ['/media/c.mp4'])]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      await new Promise((r) => setTimeout(r, 10));
      expect(extract).toHaveBeenCalledTimes(1);

      firstRun.resolve();
      await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(2));
      expect(extract.mock.calls[0]![0]).toEqual(['/media/a.mp4']);
      // The queued files are handled together in one follow-up job.
      expect([...extract.mock.calls[1]![0]].sort()).toEqual([
        '/media/b.mp4',
        '/media/c.mp4',
      ]);
      await new Promise((r) => setTimeout(r, 10));
      expect(extract).toHaveBeenCalledTimes(2);
    });

    it('runs client requests on the same job, after the running one', async () => {
      repo.setMediaDirectories([local('/media')]);
      const firstRun = deferred<void>();
      const extract = vi
        .spyOn(service, 'extractAndSaveMetadata')
        .mockReturnValueOnce(firstRun.promise)
        .mockResolvedValue(undefined);

      runScan.mockResolvedValueOnce([album('/media', ['/media/a.mp4'])]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));

      // A client asks for two files while the scan's job runs, and another
      // scan queues one of them plus a new file.
      service.queueMetadataExtraction(
        ['/media/x.mp4', '/media/b.mp4', ''],
        '/ffmpeg',
        {
          forceCheck: true,
        },
      );
      runScan.mockResolvedValueOnce([
        album('/media', ['/media/b.mp4', '/media/c.mp4']),
      ]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      await new Promise((r) => setTimeout(r, 10));
      expect(extract).toHaveBeenCalledTimes(1);

      firstRun.resolve();
      await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(3));
      // The requested files are probed even if complete (forceCheck)...
      expect(extract.mock.calls[1]).toEqual([
        ['/media/x.mp4', '/media/b.mp4'],
        '/ffmpeg',
        { forceCheck: true },
      ]);
      // ...and the scanned files are not probed a second time.
      expect(extract.mock.calls[2]).toEqual([
        ['/media/c.mp4'],
        '/ffmpeg',
        { forceCheck: false },
      ]);
    });

    it('keeps extracting after a failed extraction job', async () => {
      repo.setMediaDirectories([local('/media')]);
      vi.spyOn(repo, 'filterProcessingNeeded').mockRejectedValueOnce(
        new Error('db busy'),
      );
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const extract = vi
        .spyOn(service, 'extractAndSaveMetadata')
        .mockResolvedValue(undefined);

      runScan.mockResolvedValueOnce([album('/media', ['/media/a.mp4'])]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      await vi.waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          '[media-service] Background metadata extraction failed:',
          expect.any(Error),
        ),
      );

      runScan.mockResolvedValueOnce([album('/media', ['/media/b.mp4'])]);
      await service.scanDiskForAlbumsAndCache('/ffmpeg');
      await vi.waitFor(() =>
        expect(extract).toHaveBeenCalledWith(['/media/b.mp4'], '/ffmpeg', {
          forceCheck: false,
        }),
      );
    });
  });

  describe('F106: nested sources are scanned once', () => {
    it('collapses a source nested in another before scanning', async () => {
      repo.setMediaDirectories([
        local('/media/pictures/vacation'),
        local('/media/pictures'),
        { ...local('gdrive://folder'), type: 'google_drive' },
      ]);

      await service.scanDiskForAlbumsAndCache();

      expect(runScan).toHaveBeenCalledWith(
        expect.objectContaining({
          directories: ['/media/pictures', 'gdrive://folder'],
        }),
      );
    });
  });

  describe('F96: album textures carry playback stats', () => {
    it('copies playback position and last viewed from the stats row', async () => {
      repo.setMediaDirectories([local('/media')]);
      runScan.mockResolvedValue([
        album('/media', ['/media/watched.mp4', '/media/new.mp4']),
      ]);
      repo.setAllMetadataAndStats([
        {
          file_path: '/media/watched.mp4',
          file_path_hash: 'h',
          duration: 100,
          size: null,
          rating: null,
          created_at: null,
          view_count: 2,
          last_viewed: '2024-03-04T05:06:07.000Z',
          playback_position: 95,
        },
      ]);

      const [root] = await service.getAlbumsWithViewCounts();
      const [watched, fresh] = root!.textures;

      expect(watched).toMatchObject({
        viewCount: 2,
        duration: 100,
        playbackPosition: 95,
        lastViewed: Date.parse('2024-03-04T05:06:07.000Z'),
      });
      expect(fresh!.playbackPosition).toBeUndefined();
      expect(fresh!.lastViewed).toBeUndefined();
    });

    it('ignores an unparseable last_viewed', async () => {
      repo.setMediaDirectories([local('/media')]);
      runScan.mockResolvedValue([album('/media', ['/media/a.mp4'])]);
      repo.setAllMetadataAndStats([
        {
          file_path: '/media/a.mp4',
          file_path_hash: 'h',
          duration: null,
          size: null,
          rating: null,
          created_at: null,
          view_count: 1,
          last_viewed: 'not a date',
          playback_position: null,
        },
      ]);

      const [root] = await service.getAlbumsWithViewCounts();
      expect(root!.textures[0]!.lastViewed).toBeUndefined();
      expect(root!.textures[0]!.playbackPosition).toBeUndefined();
    });
  });

  describe('F95: failed duration probes stay retryable', () => {
    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it.each([
      ['an ffmpeg error', { error: 'moov atom not found' }],
      ['a zero duration', { duration: 0 }],
      ['a NaN duration', { duration: Number.NaN }],
    ])('stores failed for %s', async (_label, result) => {
      getVideoDuration.mockResolvedValue(result);

      await service.extractAndSaveMetadata(['/media/clip.mp4'], '/ffmpeg');

      const meta = await repo.getMetadata(['/media/clip.mp4']);
      expect(meta['/media/clip.mp4']).toEqual({
        size: 1000,
        createdAt: '2024-01-01T00:00:00.000Z',
        status: 'failed',
      });
      // ...so the next scan tries again.
      expect(await repo.filterProcessingNeeded(['/media/clip.mp4'])).toEqual([
        '/media/clip.mp4',
      ]);
    });

    it('stores success once a real duration is read', async () => {
      getVideoDuration.mockResolvedValueOnce({ error: 'busy' });
      await service.extractAndSaveMetadata(['/media/clip.mp4'], '/ffmpeg');
      getVideoDuration.mockResolvedValueOnce({ duration: 12.5 });
      await service.extractAndSaveMetadata(['/media/clip.mp4'], '/ffmpeg');

      const meta = await repo.getMetadata(['/media/clip.mp4']);
      expect(meta['/media/clip.mp4']).toMatchObject({
        status: 'success',
        duration: 12.5,
      });
    });

    it('does not probe images', async () => {
      await service.extractAndSaveMetadata(['/media/photo.jpg'], '/ffmpeg');
      expect(getVideoDuration).not.toHaveBeenCalled();
      const meta = await repo.getMetadata(['/media/photo.jpg']);
      expect(meta['/media/photo.jpg']?.status).toBe('success');
    });
  });

  describe('F100: Drive files leave the pending set', () => {
    it('stores a Drive image as success without a duration', async () => {
      getFileMetadata.mockResolvedValue({
        size: 5000,
        mimeType: 'image/jpeg',
        lastModified: new Date('2023-02-03T00:00:00.000Z'),
      });

      await service.extractAndSaveMetadata(['gdrive://img'], '/ffmpeg');

      const meta = await repo.getMetadata(['gdrive://img']);
      expect(meta['gdrive://img']).toEqual({
        status: 'success',
        size: 5000,
        createdAt: '2023-02-03T00:00:00.000Z',
      });
      expect(getVideoDuration).not.toHaveBeenCalled();
    });

    it('stores a Drive video Drive has not measured yet as failed (retryable)', async () => {
      getFileMetadata.mockResolvedValue({
        size: 0,
        mimeType: 'video/mp4',
        lastModified: new Date('invalid'),
      });

      await service.extractAndSaveMetadata(['gdrive://vid'], '/ffmpeg');

      const meta = await repo.getMetadata(['gdrive://vid']);
      expect(meta['gdrive://vid']).toEqual({ status: 'failed' });
    });

    it('stores failed when the Drive metadata call fails', async () => {
      getFileMetadata.mockRejectedValue(new Error('quota'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await service.extractAndSaveMetadata(['gdrive://vid'], '/ffmpeg');

      const meta = await repo.getMetadata(['gdrive://vid']);
      expect(meta['gdrive://vid']).toEqual({ status: 'failed' });
    });
  });
});
