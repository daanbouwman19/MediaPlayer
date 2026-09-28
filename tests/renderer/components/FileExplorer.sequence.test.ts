import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { mount, flushPromises } from '@vue/test-utils';
import FileExplorer from '@/features/library/FileExplorer.vue';
import { api } from '../../../src/renderer/api/index';

vi.mock('../../../src/renderer/api/index', () => ({
  api: {
    listDirectory: vi.fn(),
    getParentDirectory: vi.fn(),
    listGoogleDriveDirectory: vi.fn(),
    getGoogleDriveParent: vi.fn(),
  },
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const entry = (name: string, path: string) => ({
  name,
  path,
  isDirectory: true,
});

describe('FileExplorer request sequencing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('ignores a slower, older listing that resolves after a newer one', async () => {
    const slow = deferred<ReturnType<typeof entry>[]>();
    const fast = deferred<ReturnType<typeof entry>[]>();
    vi.mocked(api.listDirectory)
      .mockReturnValueOnce(slow.promise as any)
      .mockReturnValueOnce(fast.promise as any);
    vi.mocked(api.getParentDirectory).mockResolvedValue('/');

    const wrapper = mount(FileExplorer, { props: { initialPath: '/slow' } });
    await flushPromises();

    // Refresh while the first listing is still loading (goes to the root).
    await wrapper
      .find('button[aria-label="Refresh directory"]')
      .trigger('click');

    fast.resolve([entry('C:', 'C:\\')]);
    await flushPromises();
    expect(wrapper.find('.current-path').text()).toBe('My PC');
    expect(wrapper.find('[role="status"]').exists()).toBe(false);

    slow.resolve([entry('Stale', '/slow/Stale')]);
    await flushPromises();

    // The view still describes the latest request.
    expect(wrapper.find('.current-path').text()).toBe('My PC');
    expect(wrapper.text()).not.toContain('Stale');
    expect(
      wrapper
        .find('button[aria-label="Go to parent directory"]')
        .attributes('disabled'),
    ).toBeDefined();
  });

  it('keeps the loading state until the latest request finishes', async () => {
    const first = deferred<ReturnType<typeof entry>[]>();
    const second = deferred<ReturnType<typeof entry>[]>();
    vi.mocked(api.listDirectory)
      .mockReturnValueOnce(first.promise as any)
      .mockReturnValueOnce(second.promise as any);
    vi.mocked(api.getParentDirectory).mockResolvedValue('/');

    const wrapper = mount(FileExplorer, { props: { initialPath: '/one' } });
    await flushPromises();
    await wrapper
      .find('button[aria-label="Refresh directory"]')
      .trigger('click');

    first.resolve([entry('One', '/one/One')]);
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(true);

    second.resolve([entry('C:', 'C:\\')]);
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('C:');
  });

  it('ignores a stale failure', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectFirst!: (err: Error) => void;
    const first = new Promise((_resolve, reject) => {
      rejectFirst = reject;
    });
    vi.mocked(api.listDirectory)
      .mockReturnValueOnce(first as any)
      .mockResolvedValueOnce([entry('C:', 'C:\\')] as any);

    const wrapper = mount(FileExplorer, { props: { initialPath: '/gone' } });
    await flushPromises();
    await wrapper
      .find('button[aria-label="Refresh directory"]')
      .trigger('click');
    await flushPromises();

    rejectFirst(new Error('network'));
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('C:');
    consoleSpy.mockRestore();
  });

  it('applies the Drive listing and parent of the latest folder only', async () => {
    const slow = deferred<ReturnType<typeof entry>[]>();
    vi.mocked(api.listGoogleDriveDirectory)
      .mockReturnValueOnce(slow.promise as any)
      .mockResolvedValueOnce([entry('Latest', 'latest-id')] as any);
    vi.mocked(api.getGoogleDriveParent).mockResolvedValue('parent-id');

    const wrapper = mount(FileExplorer, {
      props: { mode: 'google-drive', initialPath: 'slow-id' },
    });
    await flushPromises();
    await wrapper
      .find('button[aria-label="Refresh directory"]')
      .trigger('click');
    await flushPromises();

    slow.resolve([entry('Stale', 'stale-id')]);
    await flushPromises();

    expect(wrapper.text()).toContain('Latest');
    expect(wrapper.text()).not.toContain('Stale');
  });
});
