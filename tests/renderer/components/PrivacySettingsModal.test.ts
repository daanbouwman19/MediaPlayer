import { mount, flushPromises } from '@vue/test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import { createPinia, setActivePinia } from 'pinia';
import PrivacySettingsModal from '@/features/auth/PrivacySettingsModal.vue';
import { useUIStore } from '@/composables/useUIStore';
import { useAuthStore } from '@/composables/useAuthStore';
import { usePrivacyStore } from '@/composables/usePrivacyStore';
import { usePlayerStore } from '@/composables/usePlayerStore';
import { createMockElectronAPI } from '../mocks/electronAPI';

const mountModal = () => {
  useUIStore().isPrivacyModalVisible = true;
  return mount(PrivacySettingsModal, {
    attachTo: document.body,
    global: { stubs: { CloseIcon: true, Transition: false } },
  });
};

const captureButton = (wrapper: ReturnType<typeof mount>) =>
  wrapper.find('button[aria-labelledby="privacy-panic-key-label"]');

describe('PrivacySettingsModal.vue', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is hidden until opened', () => {
    const wrapper = mount(PrivacySettingsModal);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('is a labelled dialog', () => {
    const wrapper = mountModal();
    const dialog = wrapper.find('[role="dialog"]');
    expect(dialog.attributes('aria-labelledby')).toBe('privacy-title');
    expect(wrapper.find('#privacy-title').text()).toBe('Privacy');
    wrapper.unmount();
  });

  describe('panic key capture', () => {
    it('records the next key', async () => {
      const wrapper = mountModal();
      const button = captureButton(wrapper);
      expect(button.text()).toBe('`');

      await button.trigger('click');
      expect(usePrivacyStore().isCapturingPanicKey).toBe(true);
      expect(button.text()).toBe('Press a key…');

      await button.trigger('keydown', { key: 'p', code: 'KeyP' });
      expect(usePrivacyStore().panicKey).toBe('KeyP');
      expect(usePrivacyStore().isCapturingPanicKey).toBe(false);
      expect(button.text()).toBe('P');
      wrapper.unmount();
    });

    it('rejects keys the app already uses', async () => {
      const wrapper = mountModal();
      const button = captureButton(wrapper);
      await button.trigger('click');
      await button.trigger('keydown', { key: 'z', code: 'KeyZ' });

      expect(usePrivacyStore().panicKey).toBe('Backquote');
      expect(wrapper.find('[role="alert"]').text()).toContain('already used');
      expect(usePrivacyStore().isCapturingPanicKey).toBe(true);
      wrapper.unmount();
    });

    it('ignores bare modifiers, cancels on Escape and leaves Tab alone', async () => {
      const wrapper = mountModal();
      const button = captureButton(wrapper);
      await button.trigger('click');

      await button.trigger('keydown', { key: 'Shift', code: 'ShiftLeft' });
      expect(usePrivacyStore().isCapturingPanicKey).toBe(true);

      await button.trigger('keydown', { key: 'Tab', code: 'Tab' });
      expect(usePrivacyStore().isCapturingPanicKey).toBe(true);

      await button.trigger('keydown', { key: 'Escape', code: 'Escape' });
      expect(usePrivacyStore().isCapturingPanicKey).toBe(false);
      expect(usePrivacyStore().panicKey).toBe('Backquote');
      // Escape only cancelled the capture; the dialog stays open.
      expect(useUIStore().isPrivacyModalVisible).toBe(true);

      // Keys outside capture mode do nothing.
      await button.trigger('keydown', { key: 'p', code: 'KeyP' });
      expect(usePrivacyStore().panicKey).toBe('Backquote');
      wrapper.unmount();
    });

    it('stops capturing on blur', async () => {
      const wrapper = mountModal();
      const button = captureButton(wrapper);
      await button.trigger('click');
      await button.trigger('blur');
      expect(usePrivacyStore().isCapturingPanicKey).toBe(false);
      wrapper.unmount();
    });
  });

  it('clamps the auto-lock minutes', async () => {
    const wrapper = mountModal();
    const input = wrapper.find('input[type="number"]');
    await input.setValue('-3');
    expect(usePrivacyStore().autoLockMinutes).toBe(0);
    await input.setValue('15');
    expect(usePrivacyStore().autoLockMinutes).toBe(15);
    wrapper.unmount();
  });

  it('toggles lock on blur', async () => {
    const wrapper = mountModal();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    expect(usePrivacyStore().lockOnBlur).toBe(true);
    wrapper.unmount();
  });

  it('explains the server password in web mode', () => {
    const wrapper = mountModal();
    expect(wrapper.text()).toContain('GLOBAL_PASSWORD');
    expect(wrapper.find('form').exists()).toBe(false);
    wrapper.unmount();
  });

  it('closes on Escape and the close buttons', async () => {
    const wrapper = mountModal();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(useUIStore().isPrivacyModalVisible).toBe(false);

    useUIStore().isPrivacyModalVisible = true;
    await flushPromises();
    await wrapper.find('button[aria-label="Close"]').trigger('click');
    expect(useUIStore().isPrivacyModalVisible).toBe(false);
    wrapper.unmount();
  });

  it('locks now after pausing playback', async () => {
    const wrapper = mountModal();
    const auth = useAuthStore();
    const lock = vi.spyOn(auth, 'lock').mockResolvedValue(undefined);
    const halt = vi.spyOn(usePlayerStore(), 'haltPlayback');

    const lockButton = wrapper
      .findAll('button')
      .find((b) => b.text() === 'Lock now')!;
    await lockButton.trigger('click');

    expect(halt).toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
    expect(useUIStore().isPrivacyModalVisible).toBe(false);
    wrapper.unmount();
  });

  describe('desktop PIN', () => {
    beforeEach(() => {
      window.electronAPI = createMockElectronAPI();
      setActivePinia(createPinia());
    });

    afterEach(() => {
      delete (window as { electronAPI?: unknown }).electronAPI;
    });

    const fillPin = async (
      wrapper: ReturnType<typeof mount>,
      pin: string,
      confirm = pin,
    ) => {
      const inputs = wrapper.findAll('form input[type="password"]');
      await inputs[0]!.setValue(pin);
      await inputs[1]!.setValue(confirm);
      await wrapper.find('form').trigger('submit.prevent');
      await flushPromises();
    };

    it('shows the minimize option and PIN form', () => {
      const wrapper = mountModal();
      expect(wrapper.text()).toContain('Also minimize the window');
      expect(wrapper.text()).toContain('No PIN set');
      expect(wrapper.find('form').exists()).toBe(true);
      wrapper.unmount();
    });

    it('validates and sets a PIN', async () => {
      const wrapper = mountModal();
      const setPin = vi.spyOn(useAuthStore(), 'setPin');

      await fillPin(wrapper, '12');
      expect(wrapper.find('[role="alert"]').text()).toContain('at least 4');

      await fillPin(wrapper, '1234', '4321');
      expect(wrapper.find('[role="alert"]').text()).toContain('do not match');
      expect(setPin).not.toHaveBeenCalled();

      await fillPin(wrapper, '1234');
      expect(setPin).toHaveBeenCalledWith('1234');
      expect(useAuthStore().isEnabled).toBe(true);
      expect(wrapper.text()).toContain('A PIN is set');
      wrapper.unmount();
    });

    it('shows a PIN save error', async () => {
      const wrapper = mountModal();
      vi.spyOn(useAuthStore(), 'setPin').mockRejectedValueOnce(
        new Error('App is locked'),
      );
      await fillPin(wrapper, '1234');
      expect(wrapper.find('[role="alert"]').text()).toBe('App is locked');

      vi.spyOn(useAuthStore(), 'setPin').mockRejectedValueOnce('odd');
      await fillPin(wrapper, '1234');
      expect(wrapper.find('[role="alert"]').text()).toBe(
        'Could not save the PIN.',
      );
      wrapper.unmount();
    });

    it('removes the PIN', async () => {
      useAuthStore().isEnabled = true;
      const wrapper = mountModal();
      const clearPin = vi.spyOn(useAuthStore(), 'clearPin');

      const remove = wrapper
        .findAll('button')
        .find((b) => b.text() === 'Remove PIN')!;
      await remove.trigger('click');
      await flushPromises();

      expect(clearPin).toHaveBeenCalled();
      expect(useAuthStore().isEnabled).toBe(false);
      wrapper.unmount();
    });

    it('shows a PIN removal error', async () => {
      useAuthStore().isEnabled = true;
      const wrapper = mountModal();
      const clearPin = vi
        .spyOn(useAuthStore(), 'clearPin')
        .mockRejectedValueOnce(new Error('nope'));

      const remove = () =>
        wrapper.findAll('button').find((b) => b.text() === 'Remove PIN')!;
      await remove().trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').text()).toBe('nope');

      clearPin.mockRejectedValueOnce(42);
      await remove().trigger('click');
      await flushPromises();
      expect(wrapper.find('[role="alert"]').text()).toBe(
        'Could not remove the PIN.',
      );
      wrapper.unmount();
    });
  });
});
