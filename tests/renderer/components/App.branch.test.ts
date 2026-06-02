import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import App from '../../../src/renderer/App.vue';
import { useSlideshow } from '../../../src/renderer/composables/useSlideshow';
import { useLibraryStore } from '../../../src/renderer/composables/useLibraryStore';
import { usePlayerStore } from '../../../src/renderer/composables/usePlayerStore';
import { useUIStore } from '../../../src/renderer/composables/useUIStore';
import { useAuthStore } from '../../../src/renderer/composables/useAuthStore';
import { useTheme } from '../../../src/renderer/composables/useTheme';
import { api } from '../../../src/renderer/api/index';

vi.mock('../../../src/renderer/composables/useSlideshow');
vi.mock('../../../src/renderer/composables/useTheme');
vi.mock('../../../src/renderer/api/index');

vi.mock('@/features/library/MediaGrid.vue', () => ({
  default: { template: '<div>Grid</div>' },
}));
vi.mock('@/features/player/MediaDisplay.vue', () => ({
  default: { template: '<div>Display</div>' },
}));
vi.mock('@/features/library/AlbumsList.vue', () => ({
  default: { name: 'AlbumsList', template: '<div>Albums</div>' },
}));
vi.mock('@/components/atoms/LoadingMask.vue', () => ({
  default: { template: '<div>Loading</div>' },
}));
vi.mock('@/features/player/AmbientBackground.vue', () => ({
  default: { template: '<div>BG</div>' },
}));
vi.mock('@/features/library/SourcesModal.vue', () => ({
  default: { template: '<div>Sources</div>' },
}));
vi.mock('@/features/library/SmartPlaylistModal.vue', () => ({
  default: {
    name: 'SmartPlaylistModal',
    template: '<div>SmartPlaylistModal</div>',
  },
}));

describe('App.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    setActivePinia(createTestingPinia({ createSpy: vi.fn }));

    (useTheme as Mock).mockReturnValue({
      initTheme: vi.fn(),
      cycleTheme: vi.fn(),
      applyTheme: vi.fn(),
      cleanupTheme: vi.fn(),
    });

    vi.mocked(useSlideshow).mockReturnValue({
      navigateMedia: vi.fn(),
      toggleSlideshowTimer: vi.fn(),
      slideshowTimer: ref(null),
    } as any);

    // Set initial store state
    useLibraryStore().isScanning = false;
    useLibraryStore().smartPlaylists = [];

    usePlayerStore().isSlideshowActive = false;
    usePlayerStore().slideshowTimerId = null;
    usePlayerStore().mainVideoElement = null;

    useUIStore().viewMode = 'grid';
    useUIStore().isSmartPlaylistModalVisible = false;
    useUIStore().playlistToEdit = null;
    useUIStore().isSidebarVisible = true;
    useUIStore().isControlsVisible = true;
    useUIStore().themeMode = 'system';

    useAuthStore().isLocked = false;
    useAuthStore().isInitialized = true;

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

    expect(useUIStore().isSidebarVisible).toBe(false);

    expect(toggleBtn.attributes('aria-label')).toBe('Show Albums');
    expect(wrapper.text()).not.toContain('Hide Albums');

    await toggleBtn.trigger('click');
    expect(useUIStore().isSidebarVisible).toBe(true);
    expect(toggleBtn.attributes('aria-label')).toBe('Hide Albums');
  });

  it('closes sidebar via @close event from AlbumsList', async () => {
    const wrapper = mount(App);
    await flushPromises();

    // Ensure sidebar is shown
    expect(useUIStore().isSidebarVisible).toBe(true);

    const albumsList = wrapper.findComponent({ name: 'AlbumsList' });
    albumsList.vm.$emit('close');
    await flushPromises();

    expect(useUIStore().isSidebarVisible).toBe(false);
  });

  it('clears playlistToEdit via @close event from SmartPlaylistModal', async () => {
    useUIStore().playlistToEdit = {
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

    expect(useUIStore().playlistToEdit).toBe(null);
  });
});
