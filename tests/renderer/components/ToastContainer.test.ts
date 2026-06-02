import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { useToast } from '../../../src/renderer/composables/useToast';
import ToastContainer from '@/components/organisms/ToastContainer.vue';

// Mock `useToast` to isolate component logic
vi.mock('../../../src/renderer/composables/useToast', async () => {
  const { ref } = await import('vue');
  const toasts = ref<any[]>([]);
  const add = vi.fn((message, type) => {
    toasts.value.push({ id: '1', message, type });
  });
  const remove = vi.fn((id) => {
    toasts.value = toasts.value.filter((t: any) => t.id !== id);
  });
  return {
    useToast: () => ({
      toasts,
      add,
      remove,
    }),
  };
});

describe('ToastContainer', () => {
  const { toasts, remove } = useToast();

  beforeEach(() => {
    toasts.value = [];
    vi.clearAllMocks();
  });

  it('renders a toast with correct styling', async () => {
    toasts.value = [{ id: '1', message: 'Success Message', type: 'success' }];
    const wrapper = mount(ToastContainer, {
      global: {
        stubs: {
          Teleport: true,
          TransitionGroup: false,
        },
      },
    });

    const toast = wrapper.find('[role="alert"]');
    expect(toast.exists()).toBe(true);
    expect(toast.text()).toContain('Success Message');
    expect(toast.classes()).toContain('bg-green-500/10');
  });

  it('removes a toast when close button is clicked', async () => {
    toasts.value = [{ id: '1', message: 'Message to Close', type: 'info' }];
    const wrapper = mount(ToastContainer, {
      global: {
        stubs: {
          Teleport: true,
          TransitionGroup: false,
        },
      },
    });

    const closeButton = wrapper.find('button');
    await closeButton.trigger('click');
    expect(remove).toHaveBeenCalledWith('1');
  });

  it('renders multiple toasts', () => {
    toasts.value = [
      { id: '1', message: 'Toast 1', type: 'info' },
      { id: '2', message: 'Toast 2', type: 'error' },
    ];
    const wrapper = mount(ToastContainer, {
      global: {
        stubs: {
          Teleport: true,
          TransitionGroup: false,
        },
      },
    });

    const renderedToasts = wrapper.findAll('[role="alert"]');
    expect(renderedToasts).toHaveLength(2);
    expect(renderedToasts[0].text()).toContain('Toast 1');
    expect(renderedToasts[1].text()).toContain('Toast 2');
    expect(renderedToasts[1].classes()).toContain('bg-red-500/10');
  });
});
