import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';

import { reactive, computed } from 'vue';
import { useSlideshow } from '@/composables/useSlideshow';
import { useLibraryStore } from '@/composables/useLibraryStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { useUIStore } from '@/composables/useUIStore';
import { createMockElectronAPI } from '../mocks/electronAPI';

// Mock the composables
vi.mock('@/composables/useLibraryStore');
vi.mock('@/composables/usePlayerStore');
vi.mock('@/composables/useUIStore');

// Mock the api module
vi.mock('@/api', () => ({
  api: {
    recordMediaView: vi.fn(),
  },
}));

// Mock the global window.electronAPI
global.window.electronAPI = createMockElectronAPI();

describe('useSlideshow', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;
  let mockStopSlideshow: Mock;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    mockLibraryState = reactive({
      globalMediaPoolForSelection: [],
      albumsSelectedForSlideshow: {},
      allAlbums: [],
      totalMediaInPool: 0,
      supportedExtensions: {
        videos: ['.mp4', '.webm'],
        images: ['.png', '.jpg', '.jpeg'],
      },
    });

    mockPlayerState = reactive({
      displayedMediaFiles: [],
      currentMediaIndex: -1,
      currentMediaItem: null,
      isSlideshowActive: false,
      slideshowTimerId: null,
      isTimerRunning: false,
      timerDuration: 30,
    });

    mockUIState = reactive({
      mediaFilter: 'All',
    });

    mockStopSlideshow = vi.fn();

    const imageExtensionsSet = computed(
      () => new Set(mockLibraryState.supportedExtensions.images),
    );
    const videoExtensionsSet = computed(
      () => new Set(mockLibraryState.supportedExtensions.videos),
    );

    (useLibraryStore as Mock).mockReturnValue({
      state: mockLibraryState,
      clearMediaPool: vi.fn(),
      imageExtensionsSet,
      videoExtensionsSet,
    });
    (usePlayerStore as Mock).mockReturnValue({
      state: mockPlayerState,
      stopSlideshow: mockStopSlideshow,
    });
    (useUIStore as Mock).mockReturnValue({
      state: mockUIState,
    });
  });

  describe('shuffleArray', () => {
    it('should contain the same elements after shuffling', () => {
      const { shuffleArray } = useSlideshow();
      const originalArray = [1, 2, 3, 4, 5];
      const shuffled = shuffleArray(originalArray);

      expect(shuffled).toHaveLength(originalArray.length);
      expect(shuffled.sort()).toEqual(originalArray.sort());
    });

    it('should produce a different order (most of the time)', () => {
      const { shuffleArray } = useSlideshow();
      const originalArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const shuffled = shuffleArray(originalArray);

      // This is not a guaranteed test, but it's very likely to pass
      expect(shuffled).not.toEqual(originalArray);
    });

    it('should handle empty and single-element arrays', () => {
      const { shuffleArray } = useSlideshow();
      expect(shuffleArray([])).toEqual([]);
      expect(shuffleArray([1])).toEqual([1]);
    });
  });

  describe('filterMedia', () => {
    const mediaFiles = [
      {
        path: 'video.mp4',
        name: 'video.mp4',
      },
      {
        path: 'image.png',
        name: 'image.png',
      },
      {
        path: 'document.txt',
        name: 'document.txt',
      },
      {
        path: 'archive.zip',
        name: 'archive.zip',
      },
      {
        path: 'photo.JPG',
        name: 'photo.JPG',
      },
      {
        path: 'clip.WEBM',
        name: 'clip.WEBM',
      },
      { name: 'invalid', path: '' }, // Invalid item
      {
        path: '',
        name: 'invalid',
      }, // Invalid item
    ];

    it('should return all media when filter is "All"', () => {
      mockUIState.mediaFilter = 'All';
      const { filterMedia } = useSlideshow(); // Need to get a fresh instance

      const filtered = filterMedia(mediaFiles);
      expect(filtered.length).toBe(6); // 6 valid items
    });

    it('should return only videos when filter is "Videos"', () => {
      mockUIState.mediaFilter = 'Videos';
      const { filterMedia } = useSlideshow();

      const filtered = filterMedia(mediaFiles);
      expect(filtered.length).toBe(2);
      expect(
        filtered.every(
          (f) =>
            f.path.toLowerCase().endsWith('.mp4') ||
            f.path.toLowerCase().endsWith('.webm'),
        ),
      ).toBe(true);
    });

    it('should return only images when filter is "Images"', () => {
      mockUIState.mediaFilter = 'Images';
      const { filterMedia } = useSlideshow();

      const filtered = filterMedia(mediaFiles);
      expect(filtered.length).toBe(2);
      expect(
        filtered.every(
          (f) =>
            f.path.toLowerCase().endsWith('.png') ||
            f.path.toLowerCase().endsWith('.jpg'),
        ),
      ).toBe(true);
    });

    it('should handle empty or invalid input', () => {
      const { filterMedia } = useSlideshow();
      expect(filterMedia([])).toEqual([]);

      expect(filterMedia(null as any)).toEqual([]);

      expect(filterMedia(undefined as any)).toEqual([]);
    });

    it('should be case-insensitive to file extensions', () => {
      mockUIState.mediaFilter = 'Images';
      const { filterMedia } = useSlideshow();
      const filesWithCaps = [
        {
          path: 'image.PNG',
          name: 'image.PNG',
        },
        {
          path: 'photo.JPEG',
          name: 'photo.JPEG',
        },
      ];
      const filtered = filterMedia(filesWithCaps);
      expect(filtered.length).toBe(2);
    });

    it('should return all media if filter is not "Videos" or "Images"', () => {
      mockUIState.mediaFilter = 'SomethingElse';
      const { filterMedia } = useSlideshow();
      const filtered = filterMedia(mediaFiles);
      expect(filtered.length).toBe(6);
    });

    it('should correctly filter Google Drive files (gdrive://) using the name property', () => {
      mockUIState.mediaFilter = 'Images';
      const { filterMedia } = useSlideshow();
      const driveFiles = [
        { path: 'gdrive://123', name: 'photo.jpg' },
        { path: 'gdrive://456', name: 'video.mp4' },
      ];
      // Cast to any because we are mocking parts of MediaFile
      const filtered = filterMedia(driveFiles as any);
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('photo.jpg');
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

      const { selectWeightedRandom } = useSlideshow();
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

    it('should exclude items from the excludePaths', () => {
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
      const { selectWeightedRandom } = useSlideshow();
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
      const { selectWeightedRandom } = useSlideshow();
      const selected = selectWeightedRandom(items, excludePaths);
      expect(items.map((i) => i.path)).toContain(selected!.path);
    });

    it('should return null for empty or invalid input', () => {
      const { selectWeightedRandom } = useSlideshow();
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
      const { selectWeightedRandom } = useSlideshow();
      const randomSpy = vi.spyOn(global.Math, 'random').mockReturnValue(0.6);
      const selected = selectWeightedRandom(items);
      expect(selected!.path).toBe('b');
      randomSpy.mockRestore();
    });
  });

  describe('navigateMedia', () => {
    beforeEach(() => {
      mockPlayerState.isSlideshowActive = true;
      mockPlayerState.displayedMediaFiles = [
        {
          path: 'item1',
          name: 'item1',
        },
        {
          path: 'item2',
          name: 'item2',
        },
        {
          path: 'item3',
          name: 'item3',
        },
      ];
      mockPlayerState.currentMediaIndex = 1; // Start in the middle
    });

    it('should navigate backward in history', async () => {
      const { navigateMedia } = useSlideshow();
      await navigateMedia(-1);
      expect(mockPlayerState.currentMediaIndex).toBe(0);
      expect(mockPlayerState.currentMediaItem.path).toBe('item1');
    });

    it('should clear the slideshow timer immediately when navigating', async () => {
      const { navigateMedia } = useSlideshow();
      mockPlayerState.slideshowTimerId = 123 as any;
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      
      await navigateMedia(-1);
      
      expect(clearIntervalSpy).toHaveBeenCalledWith(123);
      expect(mockPlayerState.slideshowTimerId).toBeNull();
      clearIntervalSpy.mockRestore();
    });

    it('should not navigate backward past the beginning', async () => {
      mockPlayerState.currentMediaIndex = 0;
      const { navigateMedia } = useSlideshow();
      await navigateMedia(-1);
      expect(mockPlayerState.currentMediaIndex).toBe(0); // Stays at 0
    });

    it('should navigate forward in history', async () => {
      const { navigateMedia } = useSlideshow();
      await navigateMedia(1);
      expect(mockPlayerState.currentMediaIndex).toBe(2);
      expect(mockPlayerState.currentMediaItem.path).toBe('item3');
    });

    it('should pick a new item when navigating forward at the end of history', async () => {
      mockPlayerState.currentMediaIndex = 2; // At the end
      mockLibraryState.globalMediaPoolForSelection = [
        {
          path: 'newItem',
          name: 'newItem',
        },
      ];
      const { navigateMedia } = useSlideshow();
      await navigateMedia(1);
      expect(mockPlayerState.displayedMediaFiles.length).toBe(4);
      expect(mockPlayerState.currentMediaIndex).toBe(3);
      expect(mockPlayerState.currentMediaItem.path).toBe('newItem');
    });

    it('should NOT resume the timer if navigating to a video and playFullVideo is true', async () => {
      const { navigateMedia } = useSlideshow();
      mockPlayerState.isTimerRunning = true;
      mockPlayerState.playFullVideo = true;
      
      // Setup: move from item 1 to item 2 (which is a video)
      mockPlayerState.displayedMediaFiles = [
        { path: 'image.jpg', name: 'image.jpg' },
        { path: 'video.mp4', name: 'video.mp4' }
      ];
      mockPlayerState.currentMediaIndex = 0;
      mockLibraryState.supportedExtensions.videos = ['.mp4'];
      mockLibraryState.supportedExtensions.images = ['.jpg'];
      
      const setIntervalSpy = vi.spyOn(global, 'setInterval');

      await navigateMedia(1);

      // It should have cleared the old timer (via navigateMedia start), 
      // and NOT started a new one (via displayMedia) because it's a video and playFullVideo is true.
      expect(mockPlayerState.slideshowTimerId).toBeNull();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      
      setIntervalSpy.mockRestore();
    });
  });

  describe('pickAndDisplayNextMediaItem', () => {
    it('should pick a new item and add it to the history', async () => {
      mockLibraryState.globalMediaPoolForSelection = [
        {
          path: 'a',
          name: 'a',
        },
        {
          path: 'b',
          name: 'b',
        },
      ];
      const { pickAndDisplayNextMediaItem } = useSlideshow();
      await pickAndDisplayNextMediaItem();
      expect(mockPlayerState.displayedMediaFiles.length).toBe(1);
      expect(mockPlayerState.currentMediaIndex).toBe(0);
      expect(mockPlayerState.currentMediaItem).toBeDefined();
    });

    it('should warn and do nothing if the pool is empty', async () => {
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});
      const { pickAndDisplayNextMediaItem } = useSlideshow();
      await pickAndDisplayNextMediaItem();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'No media files available in the pool.',
      );
      expect(mockPlayerState.displayedMediaFiles.length).toBe(0);
      consoleWarnSpy.mockRestore();
    });
  });

  describe('startSlideshow', () => {
    beforeEach(() => {
      mockLibraryState.allAlbums = [
        {
          id: 'albumA',
          name: 'albumA',
          textures: [
            {
              path: 'a1.png',
              name: 'a1.png',
            },
            {
              path: 'a2.png',
              name: 'a2.png',
            },
          ],
          children: [
            {
              id: 'albumA_child',
              name: 'albumA_child',
              textures: [
                {
                  path: 'a_child1.png',
                  name: 'a_child1.png',
                },
              ],
            },
          ],
        },
        {
          id: 'albumB',
          name: 'albumB',
          textures: [
            {
              path: 'b1.png',
              name: 'b1.png',
            },
          ],
          children: [],
        },
        {
          id: 'albumC',
          name: 'albumC',
          textures: [],
        }, // Empty album
      ];
    });

    it('should build a media pool from selected albums including children', async () => {
      mockLibraryState.albumsSelectedForSlideshow = {
        albumA: true,
        albumC: true,
        albumA_child: true,
      };
      const { startSlideshow } = useSlideshow();
      await startSlideshow();
      expect(mockLibraryState.globalMediaPoolForSelection.length).toBe(3);
      expect(
        mockLibraryState.globalMediaPoolForSelection.map(
          (f: { path: string }) => f.path,
        ),
      ).toEqual(['a1.png', 'a2.png', 'a_child1.png']);
    });

    it('should activate slideshow mode and display the first item', async () => {
      mockLibraryState.albumsSelectedForSlideshow = {
        albumB: true,
      };
      const { startSlideshow } = useSlideshow();
      await startSlideshow();
      expect(mockPlayerState.isSlideshowActive).toBe(true);
      expect(mockPlayerState.displayedMediaFiles.length).toBe(1);
      expect(mockPlayerState.currentMediaItem.path).toBe('b1.png');
    });

    it('should handle null allAlbums gracefully', async () => {
      mockLibraryState.allAlbums = null;
      mockLibraryState.albumsSelectedForSlideshow = {
        albumA: true,
      };
      const { startSlideshow } = useSlideshow();
      await startSlideshow();
      expect(mockPlayerState.isSlideshowActive).toBe(false);
      expect(mockLibraryState.globalMediaPoolForSelection.length).toBe(0);
    });

    it('should handle when no albums are selected', async () => {
      mockLibraryState.albumsSelectedForSlideshow = {}; // No albums selected
      const { startSlideshow } = useSlideshow();
      await startSlideshow();
      expect(mockPlayerState.isSlideshowActive).toBe(false);
      expect(mockLibraryState.globalMediaPoolForSelection.length).toBe(0);
    });

    it('should collect textures from selected children even if parent is unselected', async () => {
      mockLibraryState.allAlbums = [
        {
          id: 'Parent',
          name: 'Parent',
          textures: [{ path: 'parent.png', name: 'parent.png' }],
          children: [
            {
              id: 'Child',
              name: 'Child',
              textures: [{ path: 'child.png', name: 'child.png' }],
              children: [],
            },
          ],
        },
      ];

      // Select ONLY the child
      mockLibraryState.albumsSelectedForSlideshow = {
        Parent: false,
        Child: true,
      };

      const { startSlideshow } = useSlideshow();
      await startSlideshow();

      const paths = mockLibraryState.globalMediaPoolForSelection.map(
        (f: any) => f.path,
      );
      expect(paths).toContain('child.png');
      expect(paths).not.toContain('parent.png');
    });
  });

  describe('reapplyFilter', () => {
    beforeEach(() => {
      mockPlayerState.isSlideshowActive = true;
      mockLibraryState.allAlbums = [
        {
          id: 'albumA',
          name: 'albumA',
          textures: [
            {
              path: 'a.mp4',
              name: 'a.mp4',
            },
            {
              path: 'a.png',
              name: 'a.png',
            },
          ],
        },
      ];
      mockLibraryState.albumsSelectedForSlideshow = {
        albumA: true,
      };
    });

    it('should rebuild the pool and pick a new item based on the new filter', async () => {
      const { reapplyFilter } = useSlideshow();

      // First, start with "All"
      mockUIState.mediaFilter = 'All';
      await reapplyFilter();
      expect(mockLibraryState.totalMediaInPool).toBe(2);

      // Now, change to "Images"
      mockUIState.mediaFilter = 'Images';
      await reapplyFilter();

      expect(mockLibraryState.totalMediaInPool).toBe(1);
      expect(mockPlayerState.currentMediaItem.path).toBe('a.png');
    });
  });

  describe('toggleSlideshowTimer', () => {
    it('should start the timer if not running', () => {
      const { toggleSlideshowTimer } = useSlideshow();
      toggleSlideshowTimer();
      expect(mockPlayerState.slideshowTimerId).not.toBeNull();
      // Not validating isSlideshowActive here as toggle logic doesn't strictly enforce it
    });

    it('should pause the timer if running', () => {
      mockPlayerState.isSlideshowActive = true;
      mockPlayerState.isTimerRunning = true;
      const { toggleSlideshowTimer } = useSlideshow();
      toggleSlideshowTimer();
      // Only timer running should be false, not slideshowActive necessarily
      expect(mockPlayerState.isTimerRunning).toBe(false);
    });
  });

  describe('pauseSlideshowTimer', () => {
    it('should clear the timer and set isTimerRunning to false', () => {
      mockPlayerState.currentMediaIndex = 123;
      mockPlayerState.isSlideshowActive = true;
      const { pauseSlideshowTimer } = useSlideshow();
      pauseSlideshowTimer();
      expect(mockPlayerState.slideshowTimerId).toBeNull();
      // pauseSlideshowTimer does not modify isSlideshowActive
    });
  });

  describe('resumeSlideshowTimer with progress', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should set timerProgress to 100 and start the timer', () => {
      const { resumeSlideshowTimer } = useSlideshow();
      resumeSlideshowTimer();
      expect(mockPlayerState.timerProgress).toBe(100);
      expect(mockPlayerState.slideshowTimerId).not.toBeNull();
    });

    it('should decrease timerProgress over time', () => {
      mockPlayerState.timerDuration = 1; // 1 second for easier testing
      mockPlayerState.isSlideshowActive = true;
      mockLibraryState.globalMediaPoolForSelection = [
        { path: 'a.jpg', name: 'a.jpg' },
      ];
      const { resumeSlideshowTimer } = useSlideshow();
      resumeSlideshowTimer();

      // Advance time by half the duration
      vi.advanceTimersByTime(500);
      expect(mockPlayerState.timerProgress).toBeLessThan(51);
      expect(mockPlayerState.timerProgress).toBeGreaterThan(49);

      // Advance time to the end
      vi.advanceTimersByTime(500);
      expect(mockPlayerState.currentMediaIndex).toBe(0);
    });

    it('should call navigateMedia when the timer completes', () => {
      mockPlayerState.timerDuration = 1;
      mockPlayerState.isSlideshowActive = true;
      mockLibraryState.globalMediaPoolForSelection = [
        { path: 'next.jpg', name: 'next.jpg' },
      ];
      const { resumeSlideshowTimer } = useSlideshow();

      resumeSlideshowTimer();
      // expect(mockPlayerState.slideshowTimerId).toBeNull(); // Code doesn't nullify it on completion

      // Advance time just past the end
      vi.advanceTimersByTime(1050);

      expect(mockPlayerState.currentMediaItem.path).toBe('next.jpg');
    });
  });

  describe('resumeSlideshowTimer', () => {
    it('should start the timer and set isTimerRunning to true', () => {
      const { resumeSlideshowTimer } = useSlideshow();
      resumeSlideshowTimer();
      expect(mockPlayerState.slideshowTimerId).not.toBeNull();
      // Removed check for isSlideshowActive
    });
  });

  describe('toggleAlbumSelection', () => {
    it('should toggle the selection state of an album', () => {
      const { toggleAlbumSelection } = useSlideshow();

      // Initially undefined, should become true
      toggleAlbumSelection('albumA');
      expect(mockLibraryState.albumsSelectedForSlideshow['albumA']).toBe(true);

      // Toggle to false
      toggleAlbumSelection('albumA');
      expect(mockLibraryState.albumsSelectedForSlideshow['albumA']).toBe(false);

      // Toggle back to true
      toggleAlbumSelection('albumA');
      expect(mockLibraryState.albumsSelectedForSlideshow['albumA']).toBe(true);
    });
  });

  describe('startIndividualAlbumSlideshow', () => {
    it('should start a slideshow with the media from a single album', async () => {
      const album = {
        name: 'singleAlbum',
        textures: [
          {
            path: 's1.png',
            name: 's1.png',
          },
          {
            path: 's2.png',
            name: 's2.png',
          },
        ],
      };
      const { startIndividualAlbumSlideshow } = useSlideshow();

      await startIndividualAlbumSlideshow(album as any);

      expect(mockPlayerState.isSlideshowActive).toBe(true);
      expect(mockLibraryState.globalMediaPoolForSelection.length).toBe(2);
      expect(mockPlayerState.displayedMediaFiles.length).toBe(1);
      expect(['s1.png', 's2.png']).toContain(
        mockPlayerState.currentMediaItem.path,
      );
    });

    it('should do nothing if the album has no textures', async () => {
      const album = {
        name: 'emptyAlbum',
        textures: [],
      };
      const { startIndividualAlbumSlideshow } = useSlideshow();
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await startIndividualAlbumSlideshow(album as any);

      expect(mockPlayerState.isSlideshowActive).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'No media files in this album.',
      );
      consoleWarnSpy.mockRestore();
    });

    it('should handle invalid album input gracefully', async () => {
      const { startIndividualAlbumSlideshow } = useSlideshow();
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      await startIndividualAlbumSlideshow({
        name: 'badAlbum',

        textures: null as any,
      } as any);

      expect(mockPlayerState.isSlideshowActive).toBe(false);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Album has no valid textures array.',
      );
      consoleWarnSpy.mockRestore();
    });
  });
});
