import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
} from 'vite-plus/test';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import QueueSection from '@/features/library/AlbumsList/QueueSection.vue';
import { api } from '../../../../src/renderer/api/index';
import { usePlayerStore } from '../../../../src/renderer/composables/usePlayerStore';
import { usePlaylistStore } from '../../../../src/renderer/composables/usePlaylistStore';
import { useUIStore } from '../../../../src/renderer/composables/useUIStore';

vi.mock('../../../../src/renderer/api/index', () => ({
  api: { recordMediaView: vi.fn() },
}));

const tracks = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    name: `Track ${i + 1}`,
    path: `/track${i + 1}.jpg`,
  }));

const row = (wrapper: VueWrapper, name: string) => {
  const found = wrapper.findAll('li').find((li) => li.text().includes(name));
  if (!found) throw new Error(`No queue row for ${name}`);
  return found;
};

const queuePaths = () => usePlaylistStore().queue.map((f) => f.path);

describe('QueueSection.vue with the real playlist and slideshow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(
      createTestingPinia({ stubActions: false, createSpy: vi.fn }),
    );
    (api.recordMediaView as Mock).mockResolvedValue(undefined);
  });

  it('F156: moves the dragged entry even if the slideshow advances mid-drag', async () => {
    const playlist = usePlaylistStore();
    playlist.queue = tracks(8);
    const wrapper = mount(QueueSection);

    const dragged = row(wrapper, 'Track 6');
    await dragged.trigger('dragstart', {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });

    // The slideshow advances: Track 1 leaves the queue and every index shifts.
    playlist.playNext();
    await flushPromises();

    // Rows keep their DOM nodes (stable keys), so the drag is not torn down.
    expect(row(wrapper, 'Track 6').element).toBe(dragged.element);
    expect(row(wrapper, 'Track 6').classes()).toContain('opacity-50');

    await row(wrapper, 'Track 3').trigger('drop');

    expect(queuePaths()).toEqual([
      '/track2.jpg',
      '/track6.jpg',
      '/track3.jpg',
      '/track4.jpg',
      '/track5.jpg',
      '/track7.jpg',
      '/track8.jpg',
    ]);
  });

  it('F156: gives repeated paths distinct keys', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [a, b] = tracks(2);
    const playlist = usePlaylistStore();
    playlist.queue = [a!, b!, a!];
    const wrapper = mount(QueueSection);

    playlist.queue.push(a!);
    await flushPromises();

    expect(wrapper.findAll('li')).toHaveLength(4);
    const duplicateKeyWarnings = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes('Duplicate keys'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it('F156: removes the clicked entry', async () => {
    usePlaylistStore().queue = tracks(3);
    const wrapper = mount(QueueSection);

    await row(wrapper, 'Track 2')
      .find('button[title="Remove from queue"]')
      .trigger('click');

    expect(queuePaths()).toEqual(['/track1.jpg', '/track3.jpg']);
  });

  it('F62: playing a queued track records a view and shows the player', async () => {
    const playlist = usePlaylistStore();
    playlist.queue = tracks(3);
    useUIStore().viewMode = 'grid';
    const wrapper = mount(QueueSection);

    await wrapper
      .find('button[aria-label="Play track Track 2"]')
      .trigger('click');
    await flushPromises();

    expect(playlist.currentItem?.path).toBe('/track2.jpg');
    expect(queuePaths()).toEqual(['/track1.jpg', '/track3.jpg']);
    expect(api.recordMediaView).toHaveBeenCalledWith('/track2.jpg');
    expect(useUIStore().viewMode).toBe('player');
    expect(usePlayerStore().isSlideshowActive).toBe(true);
  });
});
