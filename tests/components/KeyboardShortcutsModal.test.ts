import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect } from 'vite-plus/test';
import KeyboardShortcutsModal from '../../src/renderer/components/organisms/KeyboardShortcutsModal.vue';

describe('KeyboardShortcutsModal', () => {
  it('does not render when isOpen is false', () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: false,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    expect(wrapper.find('div[role="dialog"]').exists()).toBe(false);
  });

  it('renders when isOpen is true', () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    expect(wrapper.find('div[role="dialog"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Keyboard Shortcuts');
  });

  it('emits close event when close button is clicked', async () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    await wrapper.find('button[aria-label="Close"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('emits close event when "Got it" button is clicked', async () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    // Find button with text 'Got it'
    const buttons = wrapper.findAll('button');
    const gotItButton = buttons.find((b) => b.text() === 'Got it');

    expect(gotItButton).toBeDefined();
    if (gotItButton) {
      await gotItButton.trigger('click');
      expect(wrapper.emitted('close')).toBeTruthy();
    }
  });

  it('emits close event when Escape key is pressed', async () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    await window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('does not emit close event when other key is pressed', async () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: true,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    await window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('does not emit close event when Escape key is pressed but modal is closed', async () => {
    const wrapper = mount(KeyboardShortcutsModal, {
      props: {
        isOpen: false,
      },
      global: {
        stubs: {
          CloseIcon: true,
        },
      },
    });

    await window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('close')).toBeFalsy();
  });

  it('moves focus into the dialog when opened and back to the opener on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Keyboard Shortcuts';
    document.body.appendChild(trigger);
    trigger.focus();

    const wrapper = mount(KeyboardShortcutsModal, {
      props: { isOpen: false },
      attachTo: document.body,
      global: { stubs: { CloseIcon: true } },
    });
    await wrapper.setProps({ isOpen: true });
    await flushPromises();

    const dialog = wrapper.find('div[role="dialog"]').element;
    expect(dialog.contains(document.activeElement)).toBe(true);

    await wrapper.setProps({ isOpen: false });
    await flushPromises();
    expect(document.activeElement).toBe(trigger);

    wrapper.unmount();
    trigger.remove();
  });
});
