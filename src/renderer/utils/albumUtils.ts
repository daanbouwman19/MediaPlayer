/**
 * @file Provides utility functions for working with album data structures.
 */
import type { Album, MediaFile } from '../../core/media/types';

/**
 * Iterates over an album or list of albums and their children using a stack-based traversal.
 * This generator yields each album node in the tree.
 *
 * @param roots - The root album or list of albums to traverse.
 * @yields Each album node in the tree (depth-first order).
 */
export function* traverseAlbumTree(roots: Album | Album[]): Generator<Album> {
  const stack = Array.isArray(roots) ? [...roots].reverse() : [roots];

  while (stack.length > 0) {
    const node = stack.pop()!;
    yield node;

    if (node.children && node.children.length > 0) {
      // Push children in reverse order so they are processed in original order
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push(node.children[i]);
      }
    }
  }
}

// Caches for expensive recursive operations
// These rely on Album objects being immutable references (which they are in the store).
// If an album is modified (e.g. children added), a new object should be created.
const textureCountCache = new WeakMap<Album, number>();
const albumIdsCache = new WeakMap<Album, string[]>();

/**
 * Recursively counts the total number of textures in an album and all its children.
 * Optimized to use iterative traversal to avoid stack overflow.
 * Uses a WeakMap cache to prevent re-traversal of the same album structure (O(1) on cache hit).
 * @param album - The album to count textures for.
 * @returns The total number of textures found in the album tree.
 */
export const countTextures = (album: Album): number => {
  if (textureCountCache.has(album)) {
    return textureCountCache.get(album)!;
  }

  let count = 0;
  for (const node of traverseAlbumTree(album)) {
    if (node.textures) {
      count += node.textures.length;
    }
  }

  textureCountCache.set(album, count);
  return count;
};

/**
 * Recursively collects all textures from an album and its children.
 * Optimized to pre-allocate the results array to avoid resizing overhead.
 * @param album - The album to start from.
 * @returns A flattened list of all media files in the album tree.
 */
export const collectTexturesRecursive = (album: Album): MediaFile[] => {
  // Optimization: Pre-calculate total size to allocate array once
  const total = countTextures(album);
  if (total === 0) return [];

  const results = new Array(total);
  let index = 0;

  for (const node of traverseAlbumTree(album)) {
    if (node.textures) {
      // Manual loop is faster than for...of for arrays in hot paths
      const len = node.textures.length;
      for (let i = 0; i < len; i++) {
        results[index++] = node.textures[i];
      }
    }
  }
  return results;
};

/**
 * Recursively gets all album IDs from a given album and its children.
 * This is useful for building a list of IDs or keys for tree traversal.
 * Optimized to use iterative traversal instead of recursion to avoid O(N^2) array copying.
 * Uses a WeakMap cache to prevent re-traversal (O(1) on cache hit).
 * @param album - The album to start from.
 * @returns A flat list of album IDs.
 */
export const getAlbumAndChildrenIds = (album: Album): readonly string[] => {
  if (albumIdsCache.has(album)) {
    // Return cached instance directly to avoid array allocation/copy.
    // Consumers must treat this as readonly.
    return albumIdsCache.get(album)!;
  }

  const ids: string[] = [];
  for (const node of traverseAlbumTree(album)) {
    ids.push(node.id);
  }

  albumIdsCache.set(album, ids);
  return ids;
};

/**
 * Recursively sets the selection state for all albums in a tree.
 * Optimized to use iterative traversal to avoid stack overflow.
 * @param albums - The albums to traverse.
 * @param selectionMap - The selection map to modify.
 * @param isSelected - The selection state to set.
 */
export const selectAllAlbums = (
  albums: Album[],
  selectionMap: { [key: string]: boolean },
  isSelected: boolean,
): void => {
  for (const node of traverseAlbumTree(albums)) {
    selectionMap[node.id] = isSelected;
  }
};

/**
 * Collects all textures (media files) from a list of albums and their children
 * if their IDs are marked as true in the provided selection map.
 * This is used to build the global media pool for the slideshow.
 * @param albums - The list of root albums to traverse.
 * @param selection - A map where keys are album IDs and values are booleans indicating selection.
 * @returns A flattened list of all media files from the selected albums.
 */
export const collectSelectedTextures = (
  albums: Album[],
  selection: { [key: string]: boolean },
): MediaFile[] => {
  const textures: MediaFile[] = [];
  for (const node of traverseAlbumTree(albums)) {
    if (selection[node.id] && node.textures) {
      // Optimization: Use a loop instead of push(...spread) to avoid stack overflow
      // on large arrays (>65k items) and reduce stack overhead.
      const len = node.textures.length;
      for (let i = 0; i < len; i++) {
        textures.push(node.textures[i]);
      }
    }
  }
  return textures;
};
