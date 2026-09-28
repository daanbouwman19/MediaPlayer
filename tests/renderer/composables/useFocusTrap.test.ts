import { describe, it, expect, afterEach } from 'vite-plus/test';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref, type PropType, type Ref } from 'vue';
import { useFocusTrap, getFocusableElements } from '@/composables/useFocusTrap';

/** A dialog with focusable, hidden, disabled and inert controls. */
const Dialog = defineComponent({
  props: {
    open: { type: Boolean, default: false },
    name: { type: String, default: 'dialog' },
    focusSecond: { type: Boolean, default: false },
    empty: { type: Boolean, default: false },
    /** Drives the dialog from a ref (like a store flag) instead of `open`. */
    source: { type: Object as PropType<Ref<boolean>>, default: null },
  },
  setup(props) {
    const container = ref<HTMLElement | null>(null);
    const second = ref<HTMLElement | null>(null);
    const isOpen = () => (props.source ? props.source.value : props.open);
    useFocusTrap(
      container,
      isOpen,
      props.focusSecond ? { initialFocus: second } : {},
    );
    return () => {
      if (!isOpen()) return null;
      if (props.empty) {
        return h('div', { ref: container, role: 'dialog' }, 'Nothing here');
      }
      return h('div', { ref: container, role: 'dialog', id: props.name }, [
        h('button', { id: `${props.name}-first` }, 'First'),
        h('input', { id: `${props.name}-second`, ref: second }),
        h('button', { style: 'display: none' }, 'Hidden'),
        h('button', { disabled: true }, 'Disabled'),
        h('div', { inert: '' }, [h('button', 'Inert')]),
        h('button', { id: `${props.name}-last` }, 'Last'),
      ]);
    };
  },
});

const wrappers: VueWrapper[] = [];
const cleanup: HTMLElement[] = [];

const mountDialog = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(Dialog, { props, attachTo: document.body });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
};

const outsideButton = (label: string) => {
  const button = document.createElement('button');
  button.textContent = label;
  document.body.appendChild(button);
  cleanup.push(button);
  return button;
};

const pressTab = (shiftKey = false) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};

const byId = (id: string) => document.getElementById(id);

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  for (const el of cleanup.splice(0)) el.remove();
});

describe('getFocusableElements', () => {
  it('skips hidden, disabled and inert elements', async () => {
    await mountDialog({ open: true });
    const ids = getFocusableElements(byId('dialog')!).map((el) => el.id);
    expect(ids).toEqual(['dialog-first', 'dialog-second', 'dialog-last']);
  });
});

describe('useFocusTrap', () => {
  it('moves focus into the dialog when it opens', async () => {
    const trigger = outsideButton('Open');
    trigger.focus();

    const wrapper = await mountDialog();
    expect(document.activeElement).toBe(trigger);

    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(document.activeElement).toBe(byId('dialog-first'));
  });

  it('focuses the requested initial element', async () => {
    await mountDialog({ open: true, focusSecond: true });
    expect(document.activeElement).toBe(byId('dialog-second'));
  });

  it('wraps Tab from the last element to the first, and Shift+Tab back', async () => {
    await mountDialog({ open: true });

    byId('dialog-last')!.focus();
    const forward = pressTab();
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('dialog-first'));

    const backward = pressTab(true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('dialog-last'));
  });

  it('leaves Tab between inner elements to the browser', async () => {
    await mountDialog({ open: true });
    byId('dialog-first')!.focus();
    expect(pressTab().defaultPrevented).toBe(false);

    byId('dialog-second')!.focus();
    expect(pressTab(true).defaultPrevented).toBe(false);
    const other = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    document.activeElement!.dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });

  it('pulls Tab from outside the dialog back in', async () => {
    await mountDialog({ open: true });

    (document.activeElement as HTMLElement).blur();
    expect(pressTab().defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(byId('dialog-first'));

    (document.activeElement as HTMLElement).blur();
    pressTab(true);
    expect(document.activeElement).toBe(byId('dialog-last'));
  });

  it('brings focus back when it moves to content behind the dialog', async () => {
    const behind = outsideButton('Behind');
    await mountDialog({ open: true });

    behind.focus();
    expect(document.activeElement).toBe(byId('dialog-first'));
  });

  it('keeps Tab from leaving a dialog without focusable elements', async () => {
    await mountDialog({ open: true, empty: true });
    expect(pressTab().defaultPrevented).toBe(true);
  });

  it('restores focus to the opener when the dialog closes', async () => {
    const trigger = outsideButton('Open');
    trigger.focus();
    const wrapper = await mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();

    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).toBe(trigger);

    // Once inactive, the trap no longer interferes with focus
    const other = outsideButton('Other');
    other.focus();
    expect(document.activeElement).toBe(other);
    expect(pressTab().defaultPrevented).toBe(false);
  });

  it('does not steal focus that is already outside the dialog when it closes', async () => {
    const trigger = outsideButton('Open');
    trigger.focus();
    // Without focusable content the trap cannot pull focus back in
    const wrapper = await mountDialog({ empty: true });
    await wrapper.setProps({ open: true });
    await flushPromises();
    const elsewhere = outsideButton('Elsewhere');
    elsewhere.focus();

    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).toBe(elsewhere);
  });

  it('lets the app move focus right after closing the dialog', async () => {
    const trigger = outsideButton('Open');
    trigger.focus();
    const open = ref(false);
    await mountDialog({ source: open });
    open.value = true;
    await flushPromises();
    expect(document.activeElement).toBe(byId('dialog-first'));

    // e.g. a save handler that closes the dialog, then focuses the new item
    const newItem = outsideButton('New item');
    open.value = false;
    newItem.focus();
    await flushPromises();
    expect(document.activeElement).toBe(newItem);
  });

  it('skips restoring when the opener is gone', async () => {
    const trigger = outsideButton('Open');
    trigger.focus();
    const wrapper = await mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();

    trigger.remove();
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('deactivates when the component unmounts', async () => {
    const trigger = outsideButton('Open');
    trigger.focus();
    const wrapper = await mountDialog({ open: true });
    expect(document.activeElement).toBe(byId('dialog-first'));

    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(document.activeElement).toBe(trigger);
  });

  describe('stacked dialogs', () => {
    it('lets only the top-most dialog trap focus and hands it back on close', async () => {
      const outer = await mountDialog({ open: true, name: 'outer' });
      byId('outer-last')!.focus();

      const inner = await mountDialog({ name: 'inner' });
      await inner.setProps({ open: true });
      await flushPromises();
      expect(document.activeElement).toBe(byId('inner-first'));

      // Tab wraps inside the inner dialog, not the outer one
      byId('inner-last')!.focus();
      pressTab();
      expect(document.activeElement).toBe(byId('inner-first'));

      await inner.setProps({ open: false });
      await flushPromises();
      expect(document.activeElement).toBe(byId('outer-last'));

      // The outer dialog traps again
      pressTab();
      expect(document.activeElement).toBe(byId('outer-first'));
      expect(outer.exists()).toBe(true);
    });

    it('sends focus past a closed parent dialog when both close', async () => {
      const trigger = outsideButton('Open');
      trigger.focus();
      const outer = await mountDialog({ name: 'outer' });
      await outer.setProps({ open: true });
      await flushPromises();
      byId('outer-last')!.focus();

      const inner = await mountDialog({ name: 'inner' });
      await inner.setProps({ open: true });
      await flushPromises();

      // The parent closes first; the child must not return focus into it
      await outer.setProps({ open: false });
      await flushPromises();
      expect(document.activeElement).toBe(byId('inner-first'));

      await inner.setProps({ open: false });
      await flushPromises();
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('falls back to treating elements as visible without checkVisibility', async () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const elementProto = Element.prototype as unknown as Record<
      string,
      unknown
    >;
    const original = elementProto.checkVisibility;
    delete elementProto.checkVisibility;
    delete proto.checkVisibility;
    try {
      await mountDialog({ open: true });
      const ids = getFocusableElements(byId('dialog')!).map((el) => el.id);
      // The display:none button is no longer filtered out
      expect(ids).toHaveLength(4);
    } finally {
      elementProto.checkVisibility = original;
    }
  });
});
