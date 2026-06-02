import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import FileExplorer from '../../../src/renderer/components/FileExplorer.vue';
import { api } from '../../../src/renderer/api/index';

// Mock the API
vi.mock('../../../src/renderer/api/index', () => ({
  api: {
    listDirectory: vi.fn(),
    getParentDirectory: vi.fn(),
  },
}));

describe('FileExplorer.a11y.test.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state with accessibility attributes', async () => {
    // Delay resolution to keep loading state active
    let resolvePromise: (value: any) => void;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    (api.listDirectory as any).mockReturnValue(promise);

    const wrapper = mount(FileExplorer, {
      props: { initialPath: '/' },
    });

    // Wait for initial render and state update
    await wrapper.vm.$nextTick();

    // Check for loading element
    const loadingEl = wrapper.find('[role="status"]');
    expect(loadingEl.exists()).toBe(true);
    expect(loadingEl.attributes('aria-live')).toBe('polite');
    expect(loadingEl.attributes('aria-label')).toBe(
      'Loading directory contents',
    );

    // Check for spinner
    expect(wrapper.find('.animate-spin').exists()).toBe(true);

    // Resolve to clean up
    resolvePromise!([{ name: 'Folder1', path: '/Folder1', isDirectory: true }]);
    (api.getParentDirectory as any).mockResolvedValue('/');
    await flushPromises();
  });

  it('renders error state with accessibility attributes', async () => {
    (api.listDirectory as any).mockRejectedValue(new Error('Failed'));
    // Suppress console error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const wrapper = mount(FileExplorer, {
      props: { initialPath: '/error' },
    });
    await flushPromises();

    const errorEl = wrapper.find('[role="alert"]');
    expect(errorEl.exists()).toBe(true);
    expect(errorEl.text()).toContain('Failed to load directory.');

    consoleSpy.mockRestore();
  });
});
