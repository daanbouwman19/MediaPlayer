import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import AlbumTree from '../../../src/renderer/components/AlbumTree.vue';

// Mock useSlideshow
const mockOpenAlbumInGrid = vi.fn();
vi.mock('../../../src/renderer/composables/useSlideshow', () => ({
  useSlideshow: () => ({
    openAlbumInGrid: mockOpenAlbumInGrid,
  }),
}));

const testAlbum = {
  id: 'root-id',
  name: 'root',
  textures: [{ name: 'root.jpg', path: '/root.jpg' }],
  children: [
    {
      id: 'child1-id',
      name: 'child1',
      textures: [{ name: 'child1.jpg', path: '/child1.jpg' }],
      children: [],
    },
    {
      id: 'child2-id',
      name: 'child2',
      textures: [{ name: 'child2.jpg', path: '/child2.jpg' }],
      children: [
        {
          id: 'grandchild-id',
          name: 'grandchild',
          textures: [{ name: 'grandchild.jpg', path: '/grandchild.jpg' }],
          children: [],
        },
      ],
    },
  ],
};

describe('AlbumTree.vue', () => {
  it('renders album name and texture count', () => {
    const wrapper = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {},
      },
    });

    expect(wrapper.text()).toContain('root');
    expect(wrapper.text()).toContain('4');
  });

  it('handles album with empty or missing children safely', () => {
    const emptyAlbum = {
      id: 'empty-id',
      name: 'empty',
      textures: [],
      children: [],
    };
    const wrapper = mount(AlbumTree, {
      props: { album: emptyAlbum, selection: {} },
    });
    expect(wrapper.find('.toggle-button').exists()).toBe(false);
  });

  it('does not render children by default', () => {
    const wrapper = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {},
      },
    });

    expect(wrapper.find('ul').exists()).toBe(false);
  });

  it('renders children when toggle button is clicked', async () => {
    const wrapper = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {},
      },
    });

    await wrapper.find('.toggle-button').trigger('click');
    const subtree = wrapper.find('ul');
    expect(subtree.exists()).toBe(true);
    expect(subtree.text()).toContain('child1');
    expect(subtree.text()).toContain('child2');
    expect(subtree.text()).toContain('1');
    expect(subtree.text()).toContain('2');
  });

  it('emits toggleSelection event when checkbox is clicked', async () => {
    const wrapper = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {},
      },
    });

    await wrapper.find('[data-testid="album-checkbox"]').trigger('click');

    expect(wrapper.emitted().toggleSelection).toBeTruthy();
    expect((wrapper.emitted().toggleSelection as unknown[][])[0][0]).toEqual({
      album: testAlbum,
      recursive: true,
    });
  });

  it('emits albumClick event when album item is clicked', async () => {
    const wrapper = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {},
      },
    });

    // Click the main action button (name + badge)
    await wrapper
      .find(`button[aria-label="Play ${testAlbum.name}"]`)
      .trigger('click');

    expect(wrapper.emitted().albumClick).toBeTruthy();
    expect((wrapper.emitted().albumClick as unknown[][])[0][0]).toEqual(
      testAlbum,
    );
  });

  it('calls openAlbumInGrid when grid button is clicked', async () => {
    const wrapper = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {},
      },
    });

    // Find the grid button by title
    const gridButton = wrapper.find('button[title="Open in Grid"]');

    expect(gridButton).toBeDefined();
    await gridButton!.trigger('click');

    expect(mockOpenAlbumInGrid).toHaveBeenCalledWith(testAlbum);
  });

  describe('selectionState', () => {
    it('is "none" when no children are selected', () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: testAlbum,
          selection: {},
        },
      });

      expect((wrapper.vm as any).selectionState).toBe('none');
    });

    it('is "all" when all children are selected', () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: testAlbum,
          selection: {
            'root-id': true,
            'child1-id': true,
            'child2-id': true,
            'grandchild-id': true,
          },
        },
      });

      expect((wrapper.vm as any).selectionState).toBe('all');
    });

    it('is "some" when some children are selected', () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: testAlbum,
          selection: {
            'root-id': true,
            'child1-id': true,
          },
        },
      });

      expect((wrapper.vm as any).selectionState).toBe('some');
    });

    it('sets checkbox to indeterminate when selectionState is "some"', async () => {
      const wrapper = mount(AlbumTree, {
        props: {
          album: testAlbum,
          selection: {
            'child1-id': true,
          },
        },
      });

      await wrapper.vm.$nextTick();
      expect(
        wrapper
          .find('[data-testid="album-checkbox"]')
          .find('div[class*="bg-accent"]')
          .exists(),
      ).toBe(true);
      expect(wrapper.find('div.w-2.h-0\\.5.bg-button-text').exists()).toBe(
        true,
      );
    });
  });

  it('has correct accessibility attributes on checkbox', async () => {
    // None selected
    const wrapper = mount(AlbumTree, {
      props: { album: testAlbum, selection: {} },
    });
    const checkbox = wrapper.find('[data-testid="album-checkbox"]');
    expect(checkbox.attributes('role')).toBe('checkbox');
    expect(checkbox.attributes('aria-checked')).toBe('false');

    // All selected
    const wrapperAll = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: {
          'root-id': true,
          'child1-id': true,
          'child2-id': true,
          'grandchild-id': true,
        },
      },
    });
    expect(
      wrapperAll
        .find('[data-testid="album-checkbox"]')
        .attributes('aria-checked'),
    ).toBe('true');

    // Mixed selection
    const wrapperSome = mount(AlbumTree, {
      props: {
        album: testAlbum,
        selection: { 'child1-id': true },
      },
    });
    expect(
      wrapperSome
        .find('[data-testid="album-checkbox"]')
        .attributes('aria-checked'),
    ).toBe('mixed');
  });

  it('has correct accessibility labels on action buttons', () => {
    const wrapper = mount(AlbumTree, {
      props: { album: testAlbum, selection: {} },
    });

    const playBtn = wrapper.find('button[title="Play Album"]');
    expect(playBtn.attributes('aria-label')).toBe('Play root');

    const gridBtn = wrapper.find('button[title="Open in Grid"]');
    expect(gridBtn.attributes('aria-label')).toBe('Open root in Grid');
  });

  it('re-emits toggleSelection from child component', async () => {
    // Need to expand to see children
    const wrapper = mount(AlbumTree, {
      props: { album: testAlbum, selection: {} },
    });
    await wrapper.find('.toggle-button').trigger('click');

    // Find child AlbumTree
    const childTree = wrapper.findComponent({ name: 'AlbumTree' });
    expect(childTree.exists()).toBe(true);

    // Emit event from child
    childTree.vm.$emit('toggleSelection', {
      album: testAlbum.children[0],
      recursive: true,
    });

    expect(wrapper.emitted().toggleSelection).toBeTruthy();
    expect((wrapper.emitted().toggleSelection as unknown[][])[0][0]).toEqual({
      album: testAlbum.children[0],
      recursive: true,
    });
  });

  it('re-emits albumClick from child component', async () => {
    const wrapper = mount(AlbumTree, {
      props: { album: testAlbum, selection: {} },
    });
    await wrapper.find('.toggle-button').trigger('click');

    const childTree = wrapper.findComponent({ name: 'AlbumTree' });
    childTree.vm.$emit('albumClick', testAlbum.children[0]);

    expect(wrapper.emitted().albumClick).toBeTruthy();
    expect((wrapper.emitted().albumClick as unknown[][])[0][0]).toEqual(
      testAlbum.children[0],
    );
  });

  it('stops propagation when clicking album controls', async () => {
    const wrapper = mount(AlbumTree, {
      props: { album: testAlbum, selection: {} },
    });

    // Clicking .album-controls should NOT trigger album click (which is on .album-item parent)
    const controls = wrapper.find('.album-controls');
    await controls.trigger('click');

    expect(wrapper.emitted().albumClick).toBeFalsy();
  });
});
