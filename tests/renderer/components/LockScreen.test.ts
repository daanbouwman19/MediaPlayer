import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import LockScreen from '@/components/LockScreen.vue';
import { useAuthStore } from '@/composables/useAuthStore';
import { useLibraryStore } from '@/composables/useLibraryStore';

describe('LockScreen.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    useAuthStore().unlock.mockResolvedValue(true);
    useLibraryStore().loadInitialData.mockResolvedValue(undefined);
  });

  it('renders correctly', () => {
    const wrapper = mount(LockScreen);
    expect(wrapper.find('h2').text()).toBe('Media Locked');
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });

  it('handles successful unlock', async () => {
    const wrapper = mount(LockScreen);
    const input = wrapper.find('input[type="password"]');

    await input.setValue('correct-password');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(useAuthStore().unlock).toHaveBeenCalledWith('correct-password');
    expect(useLibraryStore().loadInitialData).toHaveBeenCalled();
  });

  it('handles failed unlock and shows error message', async () => {
    useAuthStore().unlock.mockResolvedValueOnce(false);
    const wrapper = mount(LockScreen);

    const input = wrapper.find('input[type="password"]');
    await input.setValue('wrong-password');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(useAuthStore().unlock).toHaveBeenCalledWith('wrong-password');
    expect(useLibraryStore().loadInitialData).not.toHaveBeenCalled();

    const errorMsg = wrapper.find('.text-red-400');
    expect(errorMsg.exists()).toBe(true);
    expect(errorMsg.text()).toContain('Invalid password.');
  });

  it('handles error during unlock', async () => {
    useAuthStore().unlock.mockRejectedValueOnce(new Error('Network error'));
    const wrapper = mount(LockScreen);

    const input = wrapper.find('input[type="password"]');
    await input.setValue('error-password');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(useAuthStore().unlock).toHaveBeenCalledWith('error-password');

    const errorMsg = wrapper.find('.text-red-400');
    expect(errorMsg.exists()).toBe(true);
    expect(errorMsg.text()).toContain('An error occurred.');
  });

  it('does not submit if password is empty', async () => {
    const wrapper = mount(LockScreen);

    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(useAuthStore().unlock).not.toHaveBeenCalled();
  });
});
