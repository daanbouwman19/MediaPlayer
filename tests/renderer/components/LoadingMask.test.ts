import { describe, it, expect } from 'vite-plus/test';
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

  it('dims the app with a translucent backdrop (Tailwind v4 opacity syntax)', () => {
    const wrapper = mount(LoadingMask);
    const classes = wrapper.classes();
    // Tailwind v4 dropped bg-opacity-*, so bg-black + bg-opacity-75 renders
    // solid black; the colour must carry its own alpha.
    expect(classes).toContain('bg-black/75');
    expect(classes).not.toContain('bg-black');
    expect(classes.some((c) => c.startsWith('bg-opacity-'))).toBe(false);
  });
});
