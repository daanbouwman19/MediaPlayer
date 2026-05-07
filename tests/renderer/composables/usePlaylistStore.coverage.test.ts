import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaylistStore } from '@/composables/usePlaylistStore';

describe('usePlaylistStore Coverage Boost', () => {
  let store: ReturnType<typeof usePlaylistStore>;

  beforeEach(() => {
    store = usePlaylistStore();
    store.clearPlaylist();
  });

  it('playNext with empty queue and no item sets currentItem to null', () => {
    store.playNext();
    expect(store.currentItem).toBeNull();
  });

  it('playPrevious returns early if history is empty', () => {
    store.playPrevious();
    expect(store.currentItem).toBeNull();
  });

  it('playPrevious works when currentItem is null', () => {
    const item1 = { path: '1' } as any;
    store.playNext(item1);
    store.playNext({ path: '2' } as any);
    store.currentItem = null;
    store.playPrevious();
    expect(store.currentItem).toStrictEqual(item1);
    expect(store.queue.length).toBe(0);
  });

  it('hasNext and hasPrevious computed properties', () => {
    expect(store.hasNext).toBe(false);
    expect(store.hasPrevious).toBe(false);

    store.setQueue([{ path: '1' }] as any);
    expect(store.hasNext).toBe(true);

    store.playNext();
    expect(store.hasNext).toBe(false);

    store.playNext({ path: '2' } as any);
    expect(store.hasPrevious).toBe(true);
  });
});
