import { vi } from 'vitest';
import type { ElectronAPI } from '../../../src/preload/preload';

export const createMockElectronAPI = (): ElectronAPI => ({
  loadFileAsDataURL: vi.fn().mockResolvedValue({ type: 'data-url', url: '' }),
  getServerPort: vi.fn().mockResolvedValue(0),
  openInVlc: vi.fn().mockResolvedValue({ success: true }),
  openExternal: vi.fn().mockResolvedValue(undefined),
  getVideoMetadata: vi.fn().mockResolvedValue({}),
  recordMediaView: vi.fn().mockResolvedValue(undefined),
  getMediaViewCounts: vi.fn().mockResolvedValue({}),
  getAlbumsWithViewCounts: vi.fn().mockResolvedValue([]),
  reindexMediaLibrary: vi.fn().mockResolvedValue([]),
  addMediaDirectory: vi.fn().mockResolvedValue(null),
  removeMediaDirectory: vi.fn().mockResolvedValue(undefined),
  setDirectoryActiveState: vi.fn().mockResolvedValue(undefined),
  getMediaDirectories: vi.fn().mockResolvedValue([]),
  getSupportedExtensions: vi
    .fn()
    .mockResolvedValue({ images: [], videos: [], all: [] }),

  listDirectory: vi.fn().mockResolvedValue([]),
  getParentDirectory: vi.fn().mockResolvedValue(null),

  // Smart Playlists & Metadata
  upsertMetadata: vi.fn().mockResolvedValue(undefined),
  getMetadata: vi.fn().mockResolvedValue({}),
  setRating: vi.fn().mockResolvedValue(undefined),
  createSmartPlaylist: vi.fn().mockResolvedValue({ id: 1 }),
  getSmartPlaylists: vi.fn().mockResolvedValue([]),
  deleteSmartPlaylist: vi.fn().mockResolvedValue(undefined),
  updateSmartPlaylist: vi.fn().mockResolvedValue(undefined),
  updateWatchedSegments: vi
    .fn()
    .mockResolvedValue({ success: true, data: undefined }),

  executeSmartPlaylist: vi.fn().mockResolvedValue([]),
  getAllMetadataAndStats: vi.fn().mockResolvedValue([]),
  getRecentlyPlayed: vi.fn().mockResolvedValue([]),
  extractMetadata: vi.fn().mockResolvedValue(undefined),
  checkGoogleDriveAuth: vi
    .fn()
    .mockResolvedValue({ success: true, data: true }),
  startGoogleDriveAuth: vi.fn(),
  submitGoogleDriveAuthCode: vi.fn(),
  addGoogleDriveSource: vi.fn(),
  listGoogleDriveDirectory: vi.fn().mockResolvedValue([]),
  getGoogleDriveParent: vi.fn().mockResolvedValue(null),
  getHeatmap: vi.fn().mockResolvedValue({ audio: [], motion: [], points: 0 }),
  getHeatmapProgress: vi.fn().mockResolvedValue({ success: true, data: 50 }),
  getHlsStatus: vi.fn().mockResolvedValue({
    currentTime: 0,
    duration: 100,
    percent: 0,
  }),
});
