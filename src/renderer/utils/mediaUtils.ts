/**
 * @file Utilities for media file operations, including caching.
 */
import type { MediaFile } from '../../core/media/types';

/**
 * Cache for file extensions to reduce string operations.
 * Keyed by MediaFile object reference.
 */
const extensionCache = new WeakMap<MediaFile, string>();

/**
 * Cache for display names to reduce regex and string operations.
 * Keyed by MediaFile object reference.
 */
const displayNameCache = new WeakMap<MediaFile, string>();

/**
 * Gets the file extension for a media file, using a cache to avoid repeated string operations.
 * @param file - The media file object.
 * @returns The lowercased file extension (including the dot), or an empty string.
 */
export const getCachedExtension = (file: MediaFile): string => {
  if (extensionCache.has(file)) {
    return extensionCache.get(file)!;
  }

  // Use name if available (common for Drive files or when name is explicitly set)
  // Otherwise fallback to path.
  // Note: For GDrive paths (gdrive://...), checking path for extension is risky if the name isn't in it,
  // but usually MediaFile objects should have a name.
  const nameOrPath = file.name || file.path;

  const lastDotIndex = nameOrPath.lastIndexOf('.');

  let ext = '';
  if (lastDotIndex !== -1) {
    // Check if the dot is actually part of the filename and not a directory separator
    // (though for 'name' this is less likely, for 'path' it matters)
    const lastSlashIndex = Math.max(
      nameOrPath.lastIndexOf('/'),
      nameOrPath.lastIndexOf('\\'),
    );

    // Ensure dot is after the last slash, and not a leading dot (hidden file) unless it has an extension
    if (lastDotIndex > lastSlashIndex && lastDotIndex !== lastSlashIndex + 1) {
      ext = nameOrPath.substring(lastDotIndex).toLowerCase();
    }
  }

  extensionCache.set(file, ext);
  return ext;
};

/**
 * Gets the display name for a media file, using a cache to avoid repeated string/regex operations.
 * @param file - The media file object.
 * @returns The display name (either file.name or the basename of file.path).
 */
export const getDisplayName = (file: MediaFile): string => {
  if (displayNameCache.has(file)) {
    return displayNameCache.get(file)!;
  }

  // Optimization: file.name is preferred. If not present, extract basename from path.
  // Using simple string manipulation instead of regex for better performance.
  let displayName = file.name;

  if (!displayName) {
    const path = file.path;
    const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    displayName = lastSlash !== -1 ? path.substring(lastSlash + 1) : path;
  }

  displayNameCache.set(file, displayName);
  return displayName;
};

/**
 * Checks if a media file is an image based on its extension.
 * @param file - The media file object.
 * @param imageExtensions - Set of supported image extensions.
 * @returns True if the file is an image.
 */
export const isMediaFileImage = (
  file: MediaFile,
  imageExtensions: Set<string>,
): boolean => {
  const ext = getCachedExtension(file);
  return imageExtensions.has(ext);
};

/**
 * Checks if a media file is a video based on its extension.
 * @param file - The media file object.
 * @param videoExtensions - Set of supported video extensions.
 * @returns True if the file is a video.
 */
export const isMediaFileVideo = (
  file: MediaFile,
  videoExtensions: Set<string>,
): boolean => {
  const ext = getCachedExtension(file);
  return videoExtensions.has(ext);
};
