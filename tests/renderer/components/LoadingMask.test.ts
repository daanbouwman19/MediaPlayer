import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LoadingMask from '@/components/atoms/LoadingMask.vue';

describe('LoadingMask.vue', () => {
  it('renders the loading mask with default text', () => {
    const wrapper = mount(LoadingMask);
    expect(wrapper.find('.spinner').exists()).toBe(true);
    expect(wrapper.text()).toContain('Scanning for media...');
  });

  it('renders the loading mask with custom text', () => {
    const message = 'Loading...';
    const wrapper = mount(LoadingMask, {
      props: {
        message,
      },
    });
    expect(wrapper.text()).toContain(message);
  });
});
