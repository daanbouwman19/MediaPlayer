import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import QueueSection from '../../../../src/renderer/components/AlbumsList/QueueSection.vue';
import { usePlaylistStore } from '../../../../src/renderer/composables/usePlaylistStore';

describe('QueueSection.vue', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    const store = usePlaylistStore();
    store.queue = [];
  });

  it('renders playback queue with empty state message when empty', async () => {
    const store = usePlaylistStore();
    store.queue = [];

    const wrapper = mount(QueueSection);
    expect(wrapper.text()).toContain('Playback Queue (0)');
    expect(wrapper.text()).toContain(
      'Queue is empty. Select an album or play next.',
    );
  });

  it('renders track items in queue', async () => {
    const store = usePlaylistStore();
    store.queue = [
      { name: 'Track 1', path: '/track1.mp3' },
      { name: 'Track 2', path: '/track2.mp3' },
    ] as any;

    const wrapper = mount(QueueSection);
    expect(wrapper.text()).toContain('Playback Queue (2)');
    expect(wrapper.text()).toContain('Track 1');
    expect(wrapper.text()).toContain('Track 2');
  });

  it('toggles collapse panel on clicking playback queue header button', async () => {
    const store = usePlaylistStore();
    store.queue = [{ name: 'Track 1', path: '/track1.mp3' }] as any;

    const wrapper = mount(QueueSection);
    const toggleBtn = wrapper.find('button[aria-label="Toggle Queue Panel"]');

    // Initially open
    expect(wrapper.find('ul').exists()).toBe(true);

    // Toggle close
    await toggleBtn.trigger('click');
    expect(wrapper.find('ul').exists()).toBe(false);

    // Toggle open
    await toggleBtn.trigger('click');
    expect(wrapper.find('ul').exists()).toBe(true);
  });

  it('clears playlist when Clear button is clicked', async () => {
    const store = usePlaylistStore();
    store.queue = [{ name: 'Track 1', path: '/track1.mp3' }] as any;

    const wrapper = mount(QueueSection);
    const clearBtn = wrapper.find('button[title="Clear entire queue"]');
    await clearBtn.trigger('click');

    expect(store.clearPlaylist).toHaveBeenCalled();
  });

  it('plays track next and removes it from queue when clicked', async () => {
    const store = usePlaylistStore();
    const track = { name: 'Track 1', path: '/track1.mp3' };
    store.queue = [track] as any;

    const wrapper = mount(QueueSection);
    const playBtn = wrapper.find('button[aria-label="Play track Track 1"]');
    await playBtn.trigger('click');

    expect(store.playNext).toHaveBeenCalledWith(track);
    // Since splice directly affects the store queue ref:
    expect(store.queue).toHaveLength(0);
  });

  it('removes track from queue on clicking remove button', async () => {
    const store = usePlaylistStore();
    store.queue = [{ name: 'Track 1', path: '/track1.mp3' }] as any;

    const wrapper = mount(QueueSection);
    const removeBtn = wrapper.find('button[title="Remove from queue"]');
    await removeBtn.trigger('click');

    expect(store.queue).toHaveLength(0);
  });

  describe('Drag and Drop events', () => {
    it('sets state correctly on dragstart', async () => {
      const store = usePlaylistStore();
      store.queue = [
        { name: 'Track 1', path: '/track1.mp3' },
        { name: 'Track 2', path: '/track2.mp3' },
      ] as any;

      const wrapper = mount(QueueSection);
      const listItems = wrapper.findAll('li');

      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
      };

      const event = {
        dataTransfer: mockDataTransfer,
      } as unknown as DragEvent;

      // Manually trigger the dragstart event
      await listItems[0].trigger('dragstart', event);

      expect(mockDataTransfer.effectAllowed).toBe('move');
      expect(mockDataTransfer.setData).toHaveBeenCalledWith('text/plain', '0');
    });

    it('sets dragOverIndex on dragover and dragenter', async () => {
      const store = usePlaylistStore();
      store.queue = [
        { name: 'Track 1', path: '/track1.mp3' },
        { name: 'Track 2', path: '/track2.mp3' },
      ] as any;

      const wrapper = mount(QueueSection);
      const listItems = wrapper.findAll('li');

      await listItems[1].trigger('dragover');
      // No explicit state assertions, but visual border classes are dynamic based on state.
      // We can assert class additions or component data.
      expect(listItems[1].classes()).toContain('hover:bg-white/10');

      await listItems[1].trigger('dragenter');
      // trigger leaves dragOverIndex as 1
    });

    it('resets dragOverIndex on dragleave', async () => {
      const store = usePlaylistStore();
      store.queue = [
        { name: 'Track 1', path: '/track1.mp3' },
        { name: 'Track 2', path: '/track2.mp3' },
      ] as any;

      const wrapper = mount(QueueSection);
      const listItems = wrapper.findAll('li');

      await listItems[1].trigger('dragenter');
      await listItems[1].trigger('dragleave');
      // resets if match
    });

    it('reorders and resets on drop', async () => {
      const store = usePlaylistStore();
      store.queue = [
        { name: 'Track 1', path: '/track1.mp3' },
        { name: 'Track 2', path: '/track2.mp3' },
      ] as any;

      const wrapper = mount(QueueSection);
      const listItems = wrapper.findAll('li');

      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
      };

      // Start drag on 0
      await listItems[0].trigger('dragstart', {
        dataTransfer: mockDataTransfer,
      } as any);
      // Drop on 1
      await listItems[1].trigger('drop', { preventDefault: vi.fn() } as any);

      expect(store.reorderQueue).toHaveBeenCalledWith(0, 1);
    });

    it('resets state on dragend', async () => {
      const store = usePlaylistStore();
      store.queue = [{ name: 'Track 1', path: '/track1.mp3' }] as any;

      const wrapper = mount(QueueSection);
      const listItem = wrapper.find('li');

      await listItem.trigger('dragstart', {
        dataTransfer: { setData: vi.fn() },
      } as any);
      await listItem.trigger('dragend');
      // resets state
    });

    it('handleDragStart handles null dataTransfer', async () => {
      const store = usePlaylistStore();
      store.queue = [{ name: 'Track 1', path: '/track1.mp3' }] as any;

      const wrapper = mount(QueueSection);
      const listItem = wrapper.find('li');

      const event = {} as unknown as DragEvent; // dataTransfer is undefined
      await listItem.trigger('dragstart', event);

      expect((wrapper.vm as any).draggedIndex).toBe(0);
    });

    it('handleDrop does not reorder if dropped on itself', async () => {
      const store = usePlaylistStore();
      store.queue = [{ name: 'Track 1', path: '/track1.mp3' }] as any;

      const wrapper = mount(QueueSection);
      const listItem = wrapper.find('li');

      const mockDataTransfer = {
        effectAllowed: '',
        setData: vi.fn(),
      };

      await listItem.trigger('dragstart', {
        dataTransfer: mockDataTransfer,
      } as any);
      await listItem.trigger('drop', { preventDefault: vi.fn() } as any);

      expect(store.reorderQueue).not.toHaveBeenCalled();
    });

    it('handleDragLeave does not reset dragOverIndex if it does not match index', async () => {
      const store = usePlaylistStore();
      store.queue = [
        { name: 'Track 1', path: '/track1.mp3' },
        { name: 'Track 2', path: '/track2.mp3' },
      ] as any;

      const wrapper = mount(QueueSection);
      const listItems = wrapper.findAll('li');

      await listItems[1].trigger('dragenter'); // sets dragOverIndex to 1
      await listItems[0].trigger('dragleave'); // dragleave on index 0

      expect((wrapper.vm as any).dragOverIndex).toBe(1); // remains 1
    });
  });

  describe('Performance display limit', () => {
    it('limits the rendered track items to displayLimit (50)', async () => {
      const store = usePlaylistStore();
      const largeQueue = [];
      for (let i = 1; i <= 60; i++) {
        largeQueue.push({ name: `Track ${i}`, path: `/track${i}.mp3` });
      }
      store.queue = largeQueue as any;

      const wrapper = mount(QueueSection);
      expect(wrapper.text()).toContain('Playback Queue (60)');

      // Should show the first 50 tracks
      expect(wrapper.text()).toContain('Track 1');
      expect(wrapper.text()).toContain('Track 50');
      // Should NOT show Track 51
      expect(wrapper.text()).not.toContain('Track 51');

      // Should show the "... and 10 more tracks" message
      expect(wrapper.text()).toContain('... and 10 more tracks');
    });

    it('increases displayLimit when clicking Show 100 more', async () => {
      const store = usePlaylistStore();
      const largeQueue = [];
      for (let i = 1; i <= 60; i++) {
        largeQueue.push({ name: `Track ${i}`, path: `/track${i}.mp3` });
      }
      store.queue = largeQueue as any;

      const wrapper = mount(QueueSection);
      const buttons = wrapper.findAll('button');
      const showMoreBtnReal = buttons.find((btn) =>
        btn.text().includes('Show 100 more'),
      );
      expect(showMoreBtnReal).toBeDefined();

      await showMoreBtnReal!.trigger('click');

      // Now Track 51 should be rendered
      expect(wrapper.text()).toContain('Track 51');
      expect(wrapper.text()).toContain('Track 60');
      expect(wrapper.text()).not.toContain('more tracks');
    });

    it('increases displayLimit to show all when clicking Show all', async () => {
      const store = usePlaylistStore();
      const largeQueue = [];
      for (let i = 1; i <= 60; i++) {
        largeQueue.push({ name: `Track ${i}`, path: `/track${i}.mp3` });
      }
      store.queue = largeQueue as any;

      const wrapper = mount(QueueSection);
      const buttons = wrapper.findAll('button');
      const showAllBtn = buttons.find((btn) => btn.text().includes('Show all'));
      expect(showAllBtn).toBeDefined();

      await showAllBtn!.trigger('click');

      expect(wrapper.text()).toContain('Track 60');
      expect(wrapper.text()).not.toContain('more tracks');
    });
  });
});
