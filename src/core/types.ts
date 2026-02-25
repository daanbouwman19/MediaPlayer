/**
 * @file Shared type definitions for the application core.
 */

export interface MediaFile {
  name: string;
  path: string;
  viewCount?: number;
  rating?: number;
  lastViewed?: number;
  duration?: number;
}

export interface Album {
  id: string;
  name: string;
  textures: MediaFile[];
  children: Album[];
}

export type DirectoryType = 'local' | 'google_drive';

export interface MediaDirectory {
  id: string;
  path: string;
  type: DirectoryType;
  name: string;
  isActive: boolean;
}

export interface SmartPlaylist {
  id: number;
  name: string;
  criteria: string; // JSON string
  createdAt: string;
}

export interface MediaMetadata {
  duration?: number;
  size?: number;
  rating?: number;
  createdAt?: string; // ISO date
  status?: string; // 'pending' | 'processing' | 'success' | 'failed'
  watchedSegments?: string; // JSON string of {start, end}[]
}

export interface MediaLibraryItem {
  file_path: string;
  file_path_hash: string;
  duration: number | null;
  size: number | null;
  rating: number | null;
  created_at: string | null;
  view_count: number | null;
  last_viewed: string | null;
  watched_segments?: string | null;
}

export interface MediaLibraryStats {
  file_path: string;
  duration: number | null;
  rating: number | null;
  view_count: number;
}

export type IpcResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface HeatmapData {
  audio: number[];
  motion: number[];
  points: number;
}
