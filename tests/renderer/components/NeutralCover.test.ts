import { mount } from '@vue/test-utils';
import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { setActivePinia } from 'pinia';
import { createTestingPinia } from '@pinia/testing';
import NeutralCover from '@/features/auth/NeutralCover.vue';
import { useAuthStore } from '@/composables/useAuthStore';

describe('NeutralCover.vue', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ createSpy: vi.fn }));
  });

  it('is a labelled modal dialog', () => {
    const wrapper = mount(NeutralCover);
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-label')).toBe('Screen hidden');
  });

  it('dismisses on click', async () => {
    const wrapper = mount(NeutralCover);
    await wrapper.trigger('pointerdown');
    expect(useAuthStore().uncover).toHaveBeenCalled();
  });

  it('dismisses on a key without letting it reach other handlers', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const wrapper = mount(NeutralCover, { attachTo: document.body });

    await wrapper.trigger('keydown', { key: 'a' });

    expect(useAuthStore().uncover).toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener('keydown', outer);
    wrapper.unmount();
  });

  it('ignores bare modifier keys', async () => {
    const wrapper = mount(NeutralCover);
    await wrapper.trigger('keydown', { key: 'Shift' });
    expect(useAuthStore().uncover).not.toHaveBeenCalled();
  });
});
