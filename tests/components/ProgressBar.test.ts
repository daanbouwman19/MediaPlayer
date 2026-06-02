import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import ProgressBar from '../../src/renderer/components/atoms/ProgressBar.vue';

describe('ProgressBar', () => {
  it('seeks when ArrowRight is pressed', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('keydown', { key: 'ArrowRight' });
    expect(wrapper.emitted('seek')![0]).toEqual([15]); // 10 + 5
  });

  it('seeks when ArrowLeft is pressed', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.emitted('seek')![0]).toEqual([5]); // 10 - 5
  });

  it('seeks to 0 when Home is pressed', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 50, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('keydown', { key: 'Home' });
    expect(wrapper.emitted('seek')?.[0]).toEqual([0]);
  });

  it('seeks to duration when End is pressed', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 50, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('keydown', { key: 'End' });
    expect(wrapper.emitted('seek')?.[0]).toEqual([100]);
  });

  it('seeks +10% when PageUp is pressed', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 10, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('keydown', { key: 'PageUp' });
    expect(wrapper.emitted('seek')?.[0]).toEqual([20]); // 10 + 10 (10% of 100)
  });

  it('seeks -10% when PageDown is pressed', async () => {
    const wrapper = mount(ProgressBar, {
      props: { currentTime: 20, duration: 100 },
    });
    await wrapper
      .find('.progress-container')
      .trigger('keydown', { key: 'PageDown' });
    expect(wrapper.emitted('seek')?.[0]).toEqual([10]); // 20 - 10 (10% of 100)
  });
});
