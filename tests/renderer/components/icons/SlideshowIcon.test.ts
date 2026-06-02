import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SlideshowIcon from '@/components/atoms/icons/SlideshowIcon.vue';

describe('SlideshowIcon.vue', () => {
  it('should render the SVG icon', () => {
    const wrapper = mount(SlideshowIcon);
    expect(wrapper.find('svg').exists()).toBe(true);
  });
});
