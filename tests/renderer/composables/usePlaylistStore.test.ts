import { describe, it, expect, beforeEach } from 'vitest';
import { usePlaylistStore } from '@/composables/usePlaylistStore';

describe('usePlaylistStore', () => {
  let store: ReturnType<typeof usePlaylistStore>;

  beforeEach(() => {
    store = usePlaylistStore();
    store.clearPlaylist();
  });

  it('should initialize with empty state', () => {
    expect(store.state.history).toEqual([]);
    expect(store.state.queue).toEqual([]);
    expect(store.state.currentItem).toBeNull();
  });

  it('should set the queue and clear history', () => {
    const items = [{ path: '1' }, { path: '2' }] as any;
    store.setQueue(items);
    expect(store.state.queue).toEqual(items);
    expect(store.state.history).toEqual([]);
  });

  it('should play next item from queue', () => {
    const item1 = { path: '1' } as any;
    const item2 = { path: '2' } as any;
    store.setQueue([item1, item2]);

    store.playNext();
    expect(store.state.currentItem).toEqual(item1);
    expect(store.state.queue).toEqual([item2]);
    expect(store.state.history).toEqual([]);

    store.playNext();
    expect(store.state.currentItem).toEqual(item2);
    expect(store.state.queue).toEqual([]);
    expect(store.state.history).toEqual([item1]);
  });

  it('should play specific next item', () => {
    const item1 = { path: '1' } as any;
    const item2 = { path: '2' } as any;
    store.playNext(item1);
    expect(store.state.currentItem).toEqual(item1);

    store.playNext(item2);
    expect(store.state.currentItem).toEqual(item2);
    expect(store.state.history).toEqual([item1]);
  });

  it('should play previous item correctly', () => {
    const item1 = { path: '1' } as any;
    const item2 = { path: '2' } as any;
    store.playNext(item1);
    store.playNext(item2);

    store.playPrevious();
    expect(store.state.currentItem).toEqual(item1);
    expect(store.state.queue).toEqual([item2]);
    expect(store.state.history).toEqual([]);
  });

  it('should cap history at 100 items', () => {
    for (let i = 0; i < 110; i++) {
      store.playNext({ path: `${i}` } as any);
    }
    expect(store.state.history.length).toBe(100);
    expect(store.state.history[0].path).toBe('9'); // 109 is current, 108-9 are in history
  });
});
