import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LockScreen from '@/components/LockScreen.vue';
import { useAuthStore } from '@/composables/useAuthStore';
import { useLibraryStore } from '@/composables/useLibraryStore';

vi.mock('@/composables/useAuthStore');
vi.mock('@/composables/useLibraryStore');

describe('LockScreen.vue', () => {
  let mockUnlock: any;
  let mockLoadInitialData: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlock = vi.fn().mockResolvedValue(true);
    mockLoadInitialData = vi.fn().mockResolvedValue(undefined);

    vi.mocked(useAuthStore).mockReturnValue({
      unlock: mockUnlock,
    } as any);

    vi.mocked(useLibraryStore).mockReturnValue({
      loadInitialData: mockLoadInitialData,
    } as any);
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

    expect(mockUnlock).toHaveBeenCalledWith('correct-password');
    expect(mockLoadInitialData).toHaveBeenCalled();
    expect(wrapper.emitted('unlocked')).toBeTruthy();
  });

  it('handles failed unlock and shows error message', async () => {
    mockUnlock.mockResolvedValueOnce(false);
    const wrapper = mount(LockScreen);

    const input = wrapper.find('input[type="password"]');
    await input.setValue('wrong-password');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(mockUnlock).toHaveBeenCalledWith('wrong-password');
    expect(mockLoadInitialData).not.toHaveBeenCalled();
    expect(wrapper.emitted('unlocked')).toBeFalsy();

    const errorMsg = wrapper.find('.text-red-400');
    expect(errorMsg.exists()).toBe(true);
    expect(errorMsg.text()).toContain('Invalid password.');
  });

  it('handles error during unlock', async () => {
    mockUnlock.mockRejectedValueOnce(new Error('Network error'));
    const wrapper = mount(LockScreen);

    const input = wrapper.find('input[type="password"]');
    await input.setValue('error-password');
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(mockUnlock).toHaveBeenCalledWith('error-password');

    const errorMsg = wrapper.find('.text-red-400');
    expect(errorMsg.exists()).toBe(true);
    expect(errorMsg.text()).toContain('An error occurred.');
  });

  it('does not submit if password is empty', async () => {
    const wrapper = mount(LockScreen);

    // Try to submit with empty password
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();

    expect(mockUnlock).not.toHaveBeenCalled();
  });
});
