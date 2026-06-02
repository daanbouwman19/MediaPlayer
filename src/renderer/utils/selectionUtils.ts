/**
 * @file Provides utility functions for selecting media items from a list.
 * Includes algorithms for weighted random selection and array shuffling.
 */
import type { MediaFile } from '../../core/media/types';

/**
 * Shuffles an array in place using the Fisher-Yates shuffle algorithm.
 * @param array The array to shuffle.
 * @returns The shuffled array (same instance).
 */
export const shuffleArray = <T>(array: T[]): T[] => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Selects a random item from a list, weighted by view count (less viewed items are more likely).
 * Optimized to avoid creating intermediate arrays (filter/map) for better performance and less GC.
 *
 * The weight for each item is calculated as: 1 / ((item.viewCount || 0) + 1)
 * This gives items with 0 views a weight of 1, 1 view a weight of 0.5, etc.
 *
 * @param items - Array of media items, each with a 'path' and optional 'viewCount'.
 * @param excludePaths - A Set or array of paths to exclude from selection.
 * @returns The selected media item, or null if no item could be selected.
 */
export const selectWeightedRandom = (
  items: MediaFile[],
  excludePaths: Set<string> | string[] = [],
): MediaFile | null => {
  if (!items || items.length === 0) return null;

  // Convert array to Set if needed (O(N)), but caller should prefer passing Set (O(1) lookup)
  const excludeSet = Array.isArray(excludePaths)
    ? new Set(excludePaths)
    : excludePaths;

  let totalWeight = 0;
  let eligibleCount = 0;

  // First pass: Calculate total weight for eligible items
  // Using simple loop to avoid array allocation
  for (const item of items) {
    if (!excludeSet.has(item.path)) {
      totalWeight += 1 / ((item.viewCount || 0) + 1);
      eligibleCount++;
    }
  }

  // Fallback: If no items are eligible (all excluded), consider ALL items eligible
  let usingFallback = false;
  if (eligibleCount === 0) {
    usingFallback = true;
    totalWeight = 0;
    for (const item of items) {
      totalWeight += 1 / ((item.viewCount || 0) + 1);
    }
  }

  // Handle edge case where totalWeight is effectively zero
  // (Should be rare with 1/(count+1) unless count is infinite)
  if (totalWeight <= 1e-9) {
    const effectiveItemsCount = usingFallback ? items.length : eligibleCount;

    // Pick a random eligible item uniformly
    let targetIndex = Math.floor(Math.random() * effectiveItemsCount);
    for (const item of items) {
      if (usingFallback || !excludeSet.has(item.path)) {
        if (targetIndex === 0) return item;
        targetIndex--;
      }
    }
    // Should effectively not be reached if effectiveItemsCount > 0
    return items[items.length - 1];
  }

  let random = Math.random() * totalWeight;

  // Second pass: Find the selected item
  for (const item of items) {
    if (!usingFallback && excludeSet.has(item.path)) {
      continue;
    }

    const weight = 1 / ((item.viewCount || 0) + 1);
    random -= weight;
    if (random <= 0) return item;
  }

  // Fallback for floating point rounding errors
  // Search backwards to find the last eligible item
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (usingFallback || !excludeSet.has(item.path)) {
      return item;
    }
  }

  return null;
};
