import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
