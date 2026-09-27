import { describe, it, expect, vi } from 'vite-plus/test';
import {
  selectWeightedRandom,
  shuffleArray,
} from '../../../src/renderer/utils/selectionUtils';

describe('selectionUtils', () => {
  describe('shuffleArray', () => {
    it('should contain the same elements after shuffling', () => {
      const originalArray = [1, 2, 3, 4, 5];
      const shuffled = shuffleArray(originalArray);

      expect(shuffled).toHaveLength(originalArray.length);
      const byValue = (a: number, b: number) => a - b;
      expect(shuffled.sort(byValue)).toEqual(originalArray.sort(byValue));
    });

    it('should produce a different order (most of the time)', () => {
      const originalArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = shuffleArray(originalArray);

      // This is not a guaranteed test, but it's very likely to pass
      expect(shuffled).not.toEqual(originalArray);
    });

    it('should handle empty and single-element arrays', () => {
      expect(shuffleArray([])).toEqual([]);
      expect(shuffleArray([1])).toEqual([1]);
    });
  });

  describe('selectWeightedRandom', () => {
    it('should prioritize items with lower view counts', () => {
      const items = [
        {
          path: 'a',
          name: 'a',
          viewCount: 100,
        }, // Low weight
        {
          path: 'b',
          name: 'b',
          viewCount: 0,
        }, // High weight
        {
          path: 'c',
          name: 'c',
          viewCount: 1,
        }, // Medium-high weight
      ];

      const selections: Record<string, number> = {
        a: 0,
        b: 0,
        c: 0,
      };

      for (let i = 0; i < 100; i++) {
        const selected = selectWeightedRandom(items);
        selections[selected!.path] = (selections[selected!.path] || 0) + 1;
      }

      expect(selections['b']).toBeGreaterThan(selections['c']);
      expect(selections['c']).toBeGreaterThan(selections['a']);
    });

    it('should exclude items from the excludePaths (array)', () => {
      const items = [
        {
          path: 'a',
          name: 'a',
        },
        {
          path: 'b',
          name: 'b',
        },
        {
          path: 'c',
          name: 'c',
        },
      ];
      const excludePaths = ['a', 'c'];
      const selected = selectWeightedRandom(items, excludePaths);
      expect(selected!.path).toBe('b');
    });

    it('should exclude items from the excludePaths (Set)', () => {
      const items = [
        { path: 'a', name: 'a' },
        { path: 'b', name: 'b' },
        { path: 'c', name: 'c' },
      ];
      const excludePaths = new Set(['a', 'c']);
      const selected = selectWeightedRandom(items, excludePaths);
      expect(selected!.path).toBe('b');
    });

    it('should return an item from the original pool if all are excluded', () => {
      const items = [
        {
          path: 'a',
          name: 'a',
        },
        {
          path: 'b',
          name: 'b',
        },
      ];
      const excludePaths = ['a', 'b'];
      const selected = selectWeightedRandom(items, excludePaths);
      expect(items.map((i) => i.path)).toContain(selected!.path);
    });

    it('should return null for empty or invalid input', () => {
      expect(selectWeightedRandom([])).toBeNull();
      expect(selectWeightedRandom(null as any)).toBeNull();
    });

    it('should perform uniform random selection when items have no view counts', () => {
      const items = [
        {
          path: 'a',
          name: 'a',
        },
        {
          path: 'b',
          name: 'b',
        },
      ];
      const randomSpy = vi.spyOn(global.Math, 'random').mockReturnValue(0.6);
      const selected = selectWeightedRandom(items);
      expect(selected!.path).toBe('b');
      randomSpy.mockRestore();
    });

    it('should handle cases where total weight is extremely small', () => {
      // Create items with extremely high view counts so weights (1/(count+1)) are tiny
      const items = [
        { path: 'a', name: 'a', viewCount: Number.MAX_SAFE_INTEGER },
        { path: 'b', name: 'b', viewCount: Number.MAX_SAFE_INTEGER },
      ];

      // Mock random to force a specific selection in the fallback path
      const randomSpy = vi.spyOn(global.Math, 'random').mockReturnValue(0.9); // Will select last item
      const selected = selectWeightedRandom(items);

      expect(selected).toBeDefined();
      // Should use uniform selection fallback
      expect(['a', 'b']).toContain(selected!.path);

      randomSpy.mockRestore();
    });

    it('should handle floating point rounding errors by returning last eligible item', () => {
      const items = [{ path: 'a', name: 'a', viewCount: 0 }];

      // Force random to be greater than total weight (simulate rounding error)
      // Weight is 1.0, random is 1.1
      const randomSpy = vi.spyOn(global.Math, 'random').mockReturnValue(1.1);

      // We need to mock the internal Math.random calculation inside the function
      // The function does `let random = Math.random() * totalWeight;`
      // If totalWeight is 1, random becomes 1.1
      // Then `random -= weight` (1.1 - 1.0 = 0.1)
      // Loop finishes. It enters the fallback loop.

      // However, to truly test the `random > totalWeight` scenario properly, we need to control the `random` variable
      // inside the function, which we can't directly.
      // But we can trick it. If we set random() to return > 1.0, it multiplies by totalWeight.

      const selected = selectWeightedRandom(items);
      expect(selected).toBeDefined();
      expect(selected!.path).toBe('a');

      randomSpy.mockRestore();
    });
  });
});
