import path from 'path';
import {
  SUPPORTED_IMAGE_EXTENSIONS_SET,
  SUPPORTED_VIDEO_EXTENSIONS_SET,
} from '../constants.ts';
import { isDrivePath } from '../media-utils.ts';

const KNOWN_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

export function getMimeType(filePath: string): string {
  if (isDrivePath(filePath)) {
    return 'application/octet-stream';
  }

  // Bolt Optimization: Use Set for O(1) lookup and avoid substring(1) until needed
  const ext = path.extname(filePath).toLowerCase();

  if (SUPPORTED_IMAGE_EXTENSIONS_SET.has(ext)) {
    const extNoDot = ext.slice(1);
    return KNOWN_MIME_TYPES[extNoDot] || `image/${extNoDot}`;
  }
  if (SUPPORTED_VIDEO_EXTENSIONS_SET.has(ext)) {
    const extNoDot = ext.slice(1);
    return KNOWN_MIME_TYPES[extNoDot] || `video/${extNoDot}`;
  }
  return 'application/octet-stream';
}
