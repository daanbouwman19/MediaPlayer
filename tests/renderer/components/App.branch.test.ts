import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref, reactive } from 'vue';
import App from '../../../src/renderer/App.vue';
import { useSlideshow } from '../../../src/renderer/composables/useSlideshow';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { useAuthStore } from '../../../src/renderer/composables/useAuthStore';
import { useTheme } from '../../../src/renderer/composables/useTheme';
import { api } from '../../../src/renderer/api';

vi.mock('../../../src/renderer/composables/useSlideshow');
vi.mock('../../../src/renderer/composables/useLibraryStore');
vi.mock('../../../src/renderer/composables/usePlayerStore');
vi.mock('../../../src/renderer/composables/useUIStore');
vi.mock('../../../src/renderer/composables/useAuthStore');
vi.mock('../../../src/renderer/composables/useTheme');
vi.mock('../../../src/renderer/api');

vi.mock('../../../src/renderer/components/MediaGrid.vue', () => ({
  default: { template: '<div>Grid</div>' },
}));
vi.mock('../../../src/renderer/components/MediaDisplay.vue', () => ({
  default: { template: '<div>Display</div>' },
}));
vi.mock('../../../src/renderer/components/AlbumsList.vue', () => ({
  default: { name: 'AlbumsList', template: '<div>Albums</div>' },
}));
vi.mock('../../../src/renderer/components/LoadingMask.vue', () => ({
  default: { template: '<div>Loading</div>' },
}));
vi.mock('../../../src/renderer/components/AmbientBackground.vue', () => ({
  default: { template: '<div>BG</div>' },
}));
vi.mock('../../../src/renderer/components/SourcesModal.vue', () => ({
  default: { template: '<div>Sources</div>' },
}));
vi.mock('../../../src/renderer/components/SmartPlaylistModal.vue', () => ({
  default: {
    name: 'SmartPlaylistModal',
    template: '<div>SmartPlaylistModal</div>',
  },
}));

describe('App.vue', () => {
  let mockLibraryState: any;
  let mockPlayerState: any;
  let mockUIState: any;

  beforeEach(() => {
    vi.clearAllMocks();

    (useTheme as Mock).mockReturnValue({
      initTheme: vi.fn(),
      cycleTheme: vi.fn(),
      applyTheme: vi.fn(),
      cleanupTheme: vi.fn(),
    });

    mockLibraryState = reactive({
      isScanning: false,
      smartPlaylists: [],
    });

    const mockInitializeApp = vi.fn();
    const mockLoadAlbum = vi.fn();

    mockPlayerState = reactive({
      currentMediaIndex: 0,
      displayedMediaFiles: [{ path: '1' }, { path: '2' }],
      isSlideshowActive: false,
      slideshowTimerId: null,
      toggleSlideshow: vi.fn(),
      mainVideoElement: null,
    });

    mockUIState = reactive({
      viewMode: 'grid',
      isSmartPlaylistModalVisible: false,
      playlistToEdit: null,
      gridMediaFiles: [],
      supportedExtensions: { images: [], videos: [] },
      isSidebarVisible: true,
      isControlsVisible: true,
      themeMode: 'system',
    });

    (useLibraryStore as unknown as Mock).mockReturnValue(
      Object.assign(mockLibraryState, {
        loadInitialData: mockInitializeApp,
        loadAlbum: mockLoadAlbum,
      }),
    );

    (usePlayerStore as unknown as Mock).mockReturnValue(
      Object.assign(mockPlayerState, {
        stopSlideshow: vi.fn(),
      }),
    );

    (useUIStore as unknown as Mock).mockReturnValue(
      Object.assign(mockUIState, {}),
    );

    (useAuthStore as unknown as Mock).mockReturnValue({
      isLocked: ref(false),
      isInitialized: ref(true),
      checkLockStatus: vi.fn().mockResolvedValue(undefined),
    });

    vi.mocked(useSlideshow).mockReturnValue({
      navigateMedia: vi.fn(),
      toggleSlideshowTimer: vi.fn(),
      slideshowTimer: ref(null),
    } as any);

    (api as any).on = vi.fn();
    (api as any).off = vi.fn();
  });

  it('handles shortcuts', async () => {
    const wrapper = mount(App);
    await flushPromises();

    // Mock handlers from useSlideshow
    const { navigateMedia, toggleSlideshowTimer } = useSlideshow();

    // ArrowLeft -> Z
    const leftEvent = new KeyboardEvent('keydown', { key: 'z' });
    Object.defineProperty(leftEvent, 'target', { value: document.body });
    await document.dispatchEvent(leftEvent);
    expect(navigateMedia).toHaveBeenCalledWith(-1);

    // ArrowRight -> X
    const rightEvent = new KeyboardEvent('keydown', { key: 'x' });
    Object.defineProperty(rightEvent, 'target', { value: document.body });
    await document.dispatchEvent(rightEvent);
    expect(navigateMedia).toHaveBeenCalledWith(1);

    // Space
    const spaceEvent = new KeyboardEvent('keydown', { key: ' ' });
    Object.defineProperty(spaceEvent, 'target', { value: document.body });
    await document.dispatchEvent(spaceEvent);
    expect(toggleSlideshowTimer).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('ignores shortcuts in textarea', async () => {
    mount(App);
    await flushPromises();

    const { navigateMedia } = useSlideshow();

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const event = new KeyboardEvent('keydown', {
      key: 'z',
      bubbles: true,
    });
    Object.defineProperty(event, 'target', {
      value: textarea,
      enumerable: true,
    });
    document.dispatchEvent(event);

    expect(navigateMedia).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('toggles sidebar', async () => {
    const wrapper = mount(App);
    await flushPromises();

    const toggleBtn = wrapper.find('.icon-button');
    await toggleBtn.trigger('click');

    expect(mockUIState.isSidebarVisible).toBe(false);

    expect(toggleBtn.attributes('aria-label')).toBe('Show Albums');
    expect(wrapper.text()).not.toContain('Hide Albums');

    await toggleBtn.trigger('click');
    expect(mockUIState.isSidebarVisible).toBe(true);
    expect(toggleBtn.attributes('aria-label')).toBe('Hide Albums');
  });

  it('closes sidebar via @close event from AlbumsList', async () => {
    const wrapper = mount(App);
    await flushPromises();

    // Ensure sidebar is shown
    expect(mockUIState.isSidebarVisible).toBe(true);

    const albumsList = wrapper.findComponent({ name: 'AlbumsList' });
    albumsList.vm.$emit('close');
    await flushPromises();

    expect(mockUIState.isSidebarVisible).toBe(false);
  });

  it('clears playlistToEdit via @close event from SmartPlaylistModal', async () => {
    mockUIState.playlistToEdit = {
      id: 1,
      name: 'Test',
      criteria: '{}',
      createdAt: new Date().toISOString(),
    };

    const wrapper = mount(App);
    await flushPromises();

    const modal = wrapper.findComponent({ name: 'SmartPlaylistModal' });
    modal.vm.$emit('close');
    await flushPromises();

    expect(mockUIState.playlistToEdit).toBe(null);
  });
});
