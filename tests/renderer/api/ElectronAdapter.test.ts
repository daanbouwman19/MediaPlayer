import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { ElectronAdapter } from '../../../src/renderer/api/ElectronAdapter';
import { runBackendContractTests } from './backend.contract';

describe('ElectronAdapter', () => {
  const mockElectronAPI = {
    loadFileAsDataURL: vi.fn(),
    recordMediaView: vi.fn(),
    getMediaViewCounts: vi.fn(),
    getAlbumsWithViewCounts: vi.fn(),
    reindexMediaLibrary: vi.fn(),
    addMediaDirectory: vi.fn(),
    removeMediaDirectory: vi.fn(),
    setDirectoryActiveState: vi.fn(),
    getMediaDirectories: vi.fn(),
    getSupportedExtensions: vi.fn(),
    getServerPort: vi.fn(),
    openInVlc: vi.fn(),
    openExternal: vi.fn(),
    getVideoMetadata: vi.fn(),
    listDirectory: vi.fn(),
    getParentDirectory: vi.fn(),
    setRating: vi.fn(),
    createSmartPlaylist: vi.fn(),
    getSmartPlaylists: vi.fn(),
    updateSmartPlaylist: vi.fn(),
    deleteSmartPlaylist: vi.fn(),
    upsertMetadata: vi.fn(),
    getMetadata: vi.fn(),
    getAllMetadataAndStats: vi.fn(),
    extractMetadata: vi.fn(),
    startGoogleDriveAuth: vi.fn(),
    submitGoogleDriveAuthCode: vi.fn(),
    addGoogleDriveSource: vi.fn(),
    listGoogleDriveDirectory: vi.fn(),
    getGoogleDriveParent: vi.fn(),
    addTranscodeJobs: vi.fn(),
    listTranscodeJobs: vi.fn(),
    cancelTranscodeJob: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  runBackendContractTests(
    'ElectronAdapter',
    () => new ElectronAdapter(mockElectronAPI as any),
    (method, result, error) => {
      const mock = mockElectronAPI[method as keyof typeof mockElectronAPI];
      if (!mock) throw new Error(`Method ${method} not mocked`);

      if (method === 'getVideoMetadata' && error) {
        // Special case because getVideoMetadata returns object with optional error prop in original contract?
        // Actually ElectronAdapter.ts:110 invokes it, then checks res.error.
        // So we should return { success: true, data: { error } } or similar if that's what the bridge does?
        // Wait, looking at invoke(), if success is true, it returns data.
        // ElectronAdapter:110: const res = await this.invoke(...)
        // So res is data.
        // If we want res.error to be present, data must be { error }.
        mock.mockResolvedValue({ success: true, data: { error } });
        return;
      }

      if (error) {
        // ElectronAdapter invoke throws if result.success is false
        mock.mockResolvedValue({ success: false, error });
      } else {
        mock.mockResolvedValue({ success: true, data: result });
      }
    },
    { supportsVlc: true },
  );

  // Additional specific tests if any
  it('loadFileAsDataURL calls bridge directly', async () => {
    mockElectronAPI.loadFileAsDataURL.mockResolvedValue({
      success: true,
      data: { type: 'test' },
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    const res = await adapter.loadFileAsDataURL('file');
    expect(res).toEqual({ type: 'test' });
    expect(mockElectronAPI.loadFileAsDataURL).toHaveBeenCalledWith('file');
  });

  it('addGoogleDriveSource handles error', async () => {
    mockElectronAPI.addGoogleDriveSource.mockResolvedValue({
      success: false,
      error: 'Failed',
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    await expect(adapter.addGoogleDriveSource('id')).rejects.toThrow('Failed');
  });

  it('getMediaUrlGenerator handles local paths', async () => {
    mockElectronAPI.getServerPort.mockResolvedValue({
      success: true,
      data: 3000,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    const generator = await adapter.getMediaUrlGenerator();
    // Expect double slash as we ensure leading slash
    expect(generator('/path/to/file')).toBe(
      'http://localhost:3000//path/to/file',
    );
    expect(generator('/path/with space')).toBe(
      'http://localhost:3000//path/with%20space',
    );
    // Check windows path replacement logic if needed, but we pass / usually.
  });

  it('getMediaUrlGenerator handles gdrive paths', async () => {
    mockElectronAPI.getServerPort.mockResolvedValue({
      success: true,
      data: 3000,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    const generator = await adapter.getMediaUrlGenerator();
    expect(generator('gdrive://id')).toBe(
      'http://localhost:3000/gdrive%3A%2F%2Fid',
    );
  });

  it('URL caches serve hits and survive overflow past the size limit', async () => {
    mockElectronAPI.getServerPort.mockResolvedValue({
      success: true,
      data: 3000,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    const generator = await adapter.getMediaUrlGenerator();
    const thumbGenerator = await adapter.getThumbnailUrlGenerator();

    // Repeat access = cache hit path
    expect(generator('/repeat')).toBe(generator('/repeat'));
    expect(thumbGenerator('/repeat')).toBe(thumbGenerator('/repeat'));

    // Exceed the 10,000 entry limit; LRU evicts one entry per insert
    // instead of clearing, so results stay correct throughout
    for (let i = 0; i < 10001; i++) {
      generator(`/file-${i}`);
      thumbGenerator(`/file-${i}`);
    }
    expect(generator('/file-10000')).toBe('http://localhost:3000//file-10000');
    expect(generator('/file-0')).toBe('http://localhost:3000//file-0');
    expect(thumbGenerator('/file-0')).toBe(
      'http://localhost:3000/video/thumbnail?file=%2Ffile-0',
    );
  });

  it('getVideoMetadata throws if duration undefined', async () => {
    mockElectronAPI.getVideoMetadata.mockResolvedValue({
      success: true,
      data: {},
    }); // no duration
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    await expect(adapter.getVideoMetadata('file')).rejects.toThrow(
      'Failed to get video metadata',
    );
  });

  it('getHlsUrl returns absolute URL with port', async () => {
    mockElectronAPI.getServerPort.mockResolvedValue({
      success: true,
      data: 3000,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    const url = await adapter.getHlsUrl('C:\\path\\to\\video.mp4');
    expect(url).toBe(
      'http://localhost:3000/api/hls/master.m3u8?file=C%3A%5Cpath%5Cto%5Cvideo.mp4',
    );
  });

  it('addTranscodeJobs delegates to bridge', async () => {
    mockElectronAPI.addTranscodeJobs.mockResolvedValue({
      success: true,
      data: undefined,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    await adapter.addTranscodeJobs(['/a.mp4', '/b.mp4']);
    expect(mockElectronAPI.addTranscodeJobs).toHaveBeenCalledWith([
      '/a.mp4',
      '/b.mp4',
    ]);
  });

  it('listTranscodeJobs delegates to bridge', async () => {
    const jobs = [{ file_path: '/a.mp4', status: 'done' }];
    mockElectronAPI.listTranscodeJobs.mockResolvedValue({
      success: true,
      data: jobs,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    const result = await adapter.listTranscodeJobs();
    expect(result).toEqual(jobs);
  });

  it('cancelTranscodeJob delegates to bridge', async () => {
    mockElectronAPI.cancelTranscodeJob.mockResolvedValue({
      success: true,
      data: undefined,
    });
    const adapter = new ElectronAdapter(mockElectronAPI as any);
    await adapter.cancelTranscodeJob('/a.mp4');
    expect(mockElectronAPI.cancelTranscodeJob).toHaveBeenCalledWith('/a.mp4');
  });

  describe('getHeatmap', () => {
    const heatmap = { audio: [-90], motion: [1], points: 1 };
    const bridge = {
      getHeatmap: vi.fn(),
      cancelHeatmap: vi.fn(),
    };

    beforeEach(() => {
      bridge.getHeatmap.mockReset();
      bridge.cancelHeatmap.mockReset().mockResolvedValue({
        success: true,
        data: undefined,
      });
    });

    it('returns the heatmap without a signal', async () => {
      bridge.getHeatmap.mockResolvedValue({ success: true, data: heatmap });
      const adapter = new ElectronAdapter(bridge as any);
      await expect(adapter.getHeatmap('/v.mp4', 1)).resolves.toEqual(heatmap);
      expect(bridge.getHeatmap).toHaveBeenCalledWith('/v.mp4', 1);
    });

    it('returns the heatmap when the signal never aborts', async () => {
      bridge.getHeatmap.mockResolvedValue({ success: true, data: heatmap });
      const adapter = new ElectronAdapter(bridge as any);
      const controller = new AbortController();
      await expect(
        adapter.getHeatmap('/v.mp4', 1, { signal: controller.signal }),
      ).resolves.toEqual(heatmap);
      controller.abort();
      expect(bridge.cancelHeatmap).not.toHaveBeenCalled();
    });

    it('tells the main process and stops waiting when aborted', async () => {
      let answer!: (value: unknown) => void;
      bridge.getHeatmap.mockReturnValue(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const adapter = new ElectronAdapter(bridge as any);
      const controller = new AbortController();
      const pending = adapter.getHeatmap('/v.mp4', 100, {
        signal: controller.signal,
      });

      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(bridge.cancelHeatmap).toHaveBeenCalledWith('/v.mp4');

      // The abandoned IPC reply is ignored.
      answer({ success: false, error: 'aborted' });
    });

    it('rejects an already aborted signal', async () => {
      bridge.getHeatmap.mockResolvedValue({ success: true, data: heatmap });
      const adapter = new ElectronAdapter(bridge as any);
      const controller = new AbortController();
      controller.abort();
      await expect(
        adapter.getHeatmap('/v.mp4', 100, { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });

    it('surfaces the busy error message from the main process', async () => {
      const { isHeatmapBusyError, HEATMAP_BUSY_MESSAGE } =
        await import('../../../src/core/media/analysis/heatmap-errors');
      bridge.getHeatmap.mockResolvedValue({
        success: false,
        error: HEATMAP_BUSY_MESSAGE,
      });
      const adapter = new ElectronAdapter(bridge as any);
      const error = await adapter.getHeatmap('/v.mp4').catch((e) => e);
      expect(isHeatmapBusyError(error)).toBe(true);
    });
  });
});
