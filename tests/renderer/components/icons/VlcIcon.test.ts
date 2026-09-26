import { describe, it, expect } from 'vite-plus/test';
import { mount } from '@vue/test-utils';
import VlcIcon from '@/components/atoms/icons/VlcIcon.vue';

describe('VlcIcon.vue', () => {
  it('should render the SVG icon', () => {
    const wrapper = mount(VlcIcon);
    expect(wrapper.find('svg').exists()).toBe(true);
    expect(wrapper.classes()).toContain('feather-cone');
  });
});
