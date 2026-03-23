import { IMediaBackend, LoadResult, AuthStatus } from './types';
import type {
  Album,
  MediaDirectory,
  SmartPlaylist,
  MediaMetadata,
  MediaLibraryItem,
  HeatmapData,
} from '../../core/types';
import type { FileSystemEntry } from '../../core/file-system';

export class WebAdapter implements IMediaBackend {
  async getLockStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>('/api/auth/lock-status');
  }

  async unlock(password: string): Promise<boolean> {
    const res = await this.request<{ success: boolean }>('/api/auth/unlock', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    return res.success;
  }

  private async request<T>(
    url: string,
    options?: RequestInit & { responseType?: 'json' | 'text' },
  ): Promise<T> {
    const headers = new Headers(options?.headers);
    if (
      options?.method === 'POST' ||
      options?.method === 'PUT' ||
      options?.method === 'DELETE'
    ) {
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      // Add CSRF token for mutating requests if present in cookies
      const xsrfToken = document.cookie
        .split(';')
        .map((c) => c.trim())
        .find((row) => row.startsWith('XSRF-TOKEN='))
        ?.split('=')[1];
      if (xsrfToken) {
        headers.set('X-XSRF-TOKEN', decodeURIComponent(xsrfToken));
      }
    }

    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (res.status === 401 && !url.includes('/api/auth/unlock')) {
      // If we get a 401, the session might have expired or been locked
      // Reloading the page will trigger the AuthStore check on mount
      window.location.reload();
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      let errorMessage = res.statusText;
      try {
        const err = await res.json();
        if (err.error) errorMessage = err.error;
      } catch {
        // Ignore JSON parse error for error response
      }
      throw new Error(
        errorMessage || `Request failed with status ${res.status}`,
      );
    }

    if (options?.responseType === 'text') {
      return res.text() as unknown as T;
    }

    // Handle empty responses (e.g. 200 OK with no content)
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return res.json();
    }
    // For void returns or non-json
    return undefined as unknown as T;
  }

  async loadFileAsDataURL(filePath: string): Promise<LoadResult> {
    // In web mode, we construct a URL to the backend
    const encodedPath = encodeURIComponent(filePath);
    return {
      type: 'http-url',
      url: `/api/serve?path=${encodedPath}`,
    };
  }

  async recordMediaView(filePath: string): Promise<void> {
    await this.request<void>('/api/media/view', {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    });
  }

  async getMediaViewCounts(
    filePaths: string[],
  ): Promise<{ [filePath: string]: number }> {
    return this.request<{ [filePath: string]: number }>('/api/media/views', {
      method: 'POST',
      body: JSON.stringify({ filePaths }),
    });
  }

  async getAlbumsWithViewCounts(): Promise<Album[]> {
    return this.request<Album[]>('/api/albums');
  }

  async reindexMediaLibrary(): Promise<Album[]> {
    return this.request<Album[]>('/api/albums/reindex', { method: 'POST' });
  }

  async addMediaDirectory(path?: string): Promise<string | null> {
    if (!path) {
      console.warn('WebAdapter: Adding directory requires a path input.');
      return null;
    }
    await this.request<void>('/api/directories', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    return path;
  }

  async removeMediaDirectory(directoryPath: string): Promise<void> {
    await this.request<void>('/api/directories', {
      method: 'DELETE',
      body: JSON.stringify({ path: directoryPath }),
    });
  }

  async setDirectoryActiveState(
    directoryPath: string,
    isActive: boolean,
  ): Promise<void> {
    await this.request<void>('/api/directories/active', {
      method: 'PUT',
      body: JSON.stringify({ directoryPath, isActive }),
    });
  }

  async getMediaDirectories(): Promise<MediaDirectory[]> {
    return this.request<MediaDirectory[]>('/api/directories');
  }

  async getSupportedExtensions(): Promise<{
    images: string[];
    videos: string[];
    all: string[];
  }> {
    return this.request<{
      images: string[];
      videos: string[];
      all: string[];
    }>('/api/config/extensions');
  }

  async getServerPort(): Promise<number> {
    const port = window.location.port;
    return port ? parseInt(port, 10) : 80;
  }

  async getMediaUrlGenerator(): Promise<(filePath: string) => string> {
    return (filePath: string) =>
      `/api/serve?path=${encodeURIComponent(filePath)}`;
  }

  async getThumbnailUrlGenerator(): Promise<(filePath: string) => string> {
    return (filePath: string) =>
      `/api/thumbnail?file=${encodeURIComponent(filePath)}`;
  }

  async getVideoStreamUrlGenerator(): Promise<
    (filePath: string, startTime?: number) => string
  > {
    return (filePath: string, startTime = 0) =>
      `/api/stream?file=${encodeURIComponent(filePath)}&startTime=${startTime}`;
  }

  async getHlsUrl(filePath: string): Promise<string> {
    return `/api/hls/master.m3u8?file=${encodeURIComponent(filePath)}`;
  }

  async getHlsStatus(filePath: string): Promise<{
    currentTime: number;
    duration: number;
    percent: number;
  } | null> {
    const data = await this.request<{
      progress: {
        currentTime: number;
        duration: number;
        percent: number;
      } | null;
    }>(`/api/hls/status?file=${encodeURIComponent(filePath)}`);
    return data.progress;
  }

  async openInVlc(): Promise<{ success: boolean; message?: string }> {
    return { success: false, message: 'Not supported in Web version.' };
  }

  async getVideoMetadata(filePath: string): Promise<{ duration: number }> {
    const data = await this.request<{ duration: number }>(
      `/api/metadata?file=${encodeURIComponent(filePath)}`,
    );
    if (typeof data.duration === 'number') {
      return { duration: data.duration };
    }
    throw new Error('Failed to get video metadata');
  }

  async getHeatmap(filePath: string, points = 100): Promise<HeatmapData> {
    return this.request<HeatmapData>(
      `/api/video/heatmap?file=${encodeURIComponent(filePath)}&points=${points}`,
    );
  }

  async getHeatmapProgress(filePath: string): Promise<number | null> {
    try {
      const res = await this.request<{ progress: number | null }>(
        `/api/video/heatmap/status?file=${encodeURIComponent(filePath)}`,
      );
      return res.progress ?? null;
    } catch {
      return null;
    }
  }

  async listDirectory(directoryPath: string): Promise<FileSystemEntry[]> {
    return this.request<FileSystemEntry[]>(
      `/api/fs/ls?path=${encodeURIComponent(directoryPath)}`,
    );
  }

  async getParentDirectory(path: string): Promise<string | null> {
    try {
      const data = await this.request<{ parent: string | null }>(
        `/api/fs/parent?path=${encodeURIComponent(path)}`,
      );
      return data.parent;
    } catch {
      return null;
    }
  }

  async upsertMetadata(
    filePath: string,
    metadata: MediaMetadata,
  ): Promise<void> {
    await this.request<void>('/api/media/metadata', {
      method: 'POST',
      body: JSON.stringify({ filePath, metadata }),
    });
  }

  async getMetadata(
    filePaths: string[],
  ): Promise<{ [path: string]: MediaMetadata }> {
    try {
      return await this.request<{ [path: string]: MediaMetadata }>(
        '/api/media/metadata/batch',
        {
          method: 'POST',
          body: JSON.stringify({ filePaths }),
        },
      );
    } catch (e) {
      console.error('Failed to fetch metadata batch:', e);
      return {};
    }
  }

  async setRating(filePath: string, rating: number): Promise<void> {
    await this.request<void>('/api/media/rate', {
      method: 'POST',
      body: JSON.stringify({ filePath, rating }),
    });
  }

  async createSmartPlaylist(
    name: string,
    criteria: string,
  ): Promise<{ id: number }> {
    return this.request<{ id: number }>('/api/smart-playlists', {
      method: 'POST',
      body: JSON.stringify({ name, criteria }),
    });
  }

  async getSmartPlaylists(): Promise<SmartPlaylist[]> {
    try {
      return await this.request<SmartPlaylist[]>('/api/smart-playlists');
    } catch (e) {
      console.error('Failed to fetch smart playlists:', e);
      return [];
    }
  }

  async deleteSmartPlaylist(id: number): Promise<void> {
    await this.request<void>(`/api/smart-playlists/${id}`, {
      method: 'DELETE',
    });
  }

  async updateSmartPlaylist(
    id: number,
    name: string,
    criteria: string,
  ): Promise<void> {
    await this.request<void>(`/api/smart-playlists/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, criteria }),
    });
  }
  async updateWatchedSegments(
    _filePath: string,
    _segmentsJson: string,
  ): Promise<void> {
    void _filePath;
    void _segmentsJson;
    // Web version doesn't support persistent watch history yet
    return;
  }

  async executeSmartPlaylist(criteria: string): Promise<MediaLibraryItem[]> {
    void criteria;
    // For web version, fallback to fetching all and filtering client-side if needed,
    // or just fetch all for now.
    console.warn(
      'WebAdapter: executeSmartPlaylist not fully implemented, returning all metadata.',
    );
    return this.getAllMetadataAndStats();
  }

  async getAllMetadataAndStats(): Promise<MediaLibraryItem[]> {
    return this.request<MediaLibraryItem[]>('/api/media/all');
  }

  async getRecentlyPlayed(limit = 50): Promise<MediaLibraryItem[]> {
    return this.request<MediaLibraryItem[]>(
      `/api/media/history?limit=${limit}`,
    );
  }

  async extractMetadata(filePaths: string[]): Promise<void> {
    await this.request<void>('/api/media/extract-metadata', {
      method: 'POST',
      body: JSON.stringify({ filePaths }),
    });
  }

  // Google Drive
  async startGoogleDriveAuth(): Promise<string> {
    const url = await this.request<string>('/api/auth/google-drive/start', {
      responseType: 'text',
    });
    window.open(url, '_blank');
    return url;
  }

  async submitGoogleDriveAuthCode(code: string): Promise<boolean> {
    await this.request<void>('/api/auth/google-drive/code', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
    return true;
  }

  async addGoogleDriveSource(folderId: string): Promise<{ name?: string }> {
    const data = await this.request<{ name: string }>(
      '/api/sources/google-drive',
      {
        method: 'POST',
        body: JSON.stringify({ folderId }),
      },
    );
    return { name: data.name };
  }

  async listGoogleDriveDirectory(folderId: string): Promise<FileSystemEntry[]> {
    const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
    return this.request<FileSystemEntry[]>(`/api/drive/files${query}`);
  }

  async getGoogleDriveParent(folderId: string): Promise<string | null> {
    try {
      const data = await this.request<{ parent: string | null }>(
        `/api/drive/parent?folderId=${encodeURIComponent(folderId)}`,
      );
      return data.parent;
    } catch {
      return null;
    }
  }
}
