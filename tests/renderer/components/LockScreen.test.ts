import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import LockScreen from '@/features/auth/LockScreen.vue';
import { useAuthStore } from '@/composables/useAuthStore';
import { useLibraryStore } from '@/composables/useLibraryStore';

describe('LockScreen.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
    vi.mocked(useAuthStore().unlock).mockResolvedValue('ok');
    vi.mocked(useLibraryStore().loadInitialData).mockResolvedValue(undefined);
  });

  const submit = async (wrapper: ReturnType<typeof mount>, value: string) => {
    await wrapper.find('input[type="password"]').setValue(value);
    await wrapper.find('form').trigger('submit.prevent');
    await flushPromises();
  };

  it('renders correctly', () => {
    const wrapper = mount(LockScreen);
    expect(wrapper.find('h2').text()).toBe('Media Locked');
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
  });

  it('handles successful unlock', async () => {
    const wrapper = mount(LockScreen);
    await submit(wrapper, 'correct-password');

    expect(useAuthStore().unlock).toHaveBeenCalledWith('correct-password');
    expect(useLibraryStore().loadInitialData).toHaveBeenCalled();
  });

  it('handles failed unlock and shows error message', async () => {
    vi.mocked(useAuthStore().unlock).mockResolvedValueOnce('invalid');
    const wrapper = mount(LockScreen);
    await submit(wrapper, 'wrong-password');

    expect(useAuthStore().unlock).toHaveBeenCalledWith('wrong-password');
    expect(useLibraryStore().loadInitialData).not.toHaveBeenCalled();

    const errorMsg = wrapper.find('[role="alert"]');
    expect(errorMsg.exists()).toBe(true);
    expect(errorMsg.text()).toContain('Invalid password.');
    // A rejected password is cleared so the user can retype it
    expect(
      (wrapper.find('input[type="password"]').element as HTMLInputElement)
        .value,
    ).toBe('');
  });

  it('reports rate limiting instead of a wrong password and keeps the input', async () => {
    vi.mocked(useAuthStore().unlock).mockResolvedValueOnce('rateLimited');
    const wrapper = mount(LockScreen);
    await submit(wrapper, 'maybe-correct');

    const errorMsg = wrapper.find('[role="alert"]');
    expect(errorMsg.text()).toContain('Too many attempts');
    expect(errorMsg.text()).not.toContain('Invalid password');
    expect(
      (wrapper.find('input[type="password"]').element as HTMLInputElement)
        .value,
    ).toBe('maybe-correct');
    expect(useLibraryStore().loadInitialData).not.toHaveBeenCalled();
  });

  it('reports network/server failures instead of a wrong password', async () => {
    vi.mocked(useAuthStore().unlock).mockResolvedValueOnce('error');
    const wrapper = mount(LockScreen);
    await submit(wrapper, 'maybe-correct');

    const errorMsg = wrapper.find('[role="alert"]');
    expect(errorMsg.text()).toContain('Could not verify the password');
    expect(errorMsg.text()).not.toContain('Invalid password');
    expect(
      (wrapper.find('input[type="password"]').element as HTMLInputElement)
        .value,
    ).toBe('maybe-correct');
  });

  it('handles error during unlock', async () => {
    vi.mocked(useAuthStore().unlock).mockRejectedValueOnce(
      new Error('Network error'),
    );
    const wrapper = mount(LockScreen);
    await submit(wrapper, 'error-password');

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

  it('focuses the password input on mount and again after a failed attempt', async () => {
    vi.mocked(useAuthStore().unlock).mockResolvedValueOnce('invalid');
    const wrapper = mount(LockScreen, { attachTo: document.body });
    await flushPromises();

    const input = wrapper.find('input[type="password"]')
      .element as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    input.blur();
    await submit(wrapper, 'wrong-password');
    expect(document.activeElement).toBe(input);

    wrapper.unmount();
  });
});
