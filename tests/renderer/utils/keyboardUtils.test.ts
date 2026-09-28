import { describe, it, expect, afterEach } from 'vite-plus/test';
import {
  isActivatableTarget,
  isEditableTarget,
  isModalOpen,
  shouldIgnoreGlobalShortcut,
} from '@/utils/keyboardUtils';

const el = (html: string): HTMLElement => {
  const container = document.createElement('div');
  container.innerHTML = html;
  const child = container.firstElementChild as HTMLElement;
  document.body.append(child);
  return child;
};

const keydown = (target: EventTarget, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  let seen: KeyboardEvent | null = null;
  const listener = (e: Event) => {
    seen = e as KeyboardEvent;
  };
  document.addEventListener('keydown', listener);
  target.dispatchEvent(event);
  document.removeEventListener('keydown', listener);
  return seen!;
};

describe('keyboardUtils', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('isEditableTarget', () => {
    it.each([
      '<input type="text">',
      '<input type="range">',
      '<input type="checkbox">',
      '<textarea></textarea>',
      '<select><option>a</option></select>',
    ])('is true for %s', (html) => {
      expect(isEditableTarget(el(html))).toBe(true);
    });

    it('is true for contenteditable elements', () => {
      const div = el('<div contenteditable="true"></div>');
      Object.defineProperty(div, 'isContentEditable', { value: true });
      expect(isEditableTarget(div)).toBe(true);
    });

    it('is false for other elements and non-elements', () => {
      expect(isEditableTarget(el('<button></button>'))).toBe(false);
      expect(isEditableTarget(el('<div></div>'))).toBe(false);
      expect(isEditableTarget(document)).toBe(false);
      expect(isEditableTarget(window)).toBe(false);
      expect(isEditableTarget(null)).toBe(false);
    });
  });

  describe('isActivatableTarget', () => {
    it.each([
      '<button></button>',
      '<a href="#x"></a>',
      '<summary></summary>',
      '<div role="button" tabindex="0"></div>',
      '<button role="checkbox" aria-checked="false"></button>',
      '<div role="tab" tabindex="0"></div>',
    ])('is true for %s', (html) => {
      expect(isActivatableTarget(el(html))).toBe(true);
    });

    it('is false for plain elements, sliders and non-elements', () => {
      expect(isActivatableTarget(el('<div tabindex="-1"></div>'))).toBe(false);
      expect(isActivatableTarget(el('<a></a>'))).toBe(false);
      expect(isActivatableTarget(el('<div role="slider"></div>'))).toBe(false);
      expect(isActivatableTarget(document)).toBe(false);
      expect(isActivatableTarget(null)).toBe(false);
    });
  });

  describe('isModalOpen', () => {
    it('reflects whether an aria-modal dialog is rendered', () => {
      expect(isModalOpen()).toBe(false);
      const dialog = el('<div role="dialog" aria-modal="true"></div>');
      expect(isModalOpen()).toBe(true);
      dialog.remove();
      expect(isModalOpen()).toBe(false);
    });
  });

  describe('shouldIgnoreGlobalShortcut', () => {
    it('handles plain keys on the page', () => {
      expect(shouldIgnoreGlobalShortcut(keydown(document.body))).toBe(false);
      expect(
        shouldIgnoreGlobalShortcut(keydown(document.body, { shiftKey: true })),
      ).toBe(false);
    });

    it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])(
      'ignores modifier chords %o',
      (init) => {
        expect(shouldIgnoreGlobalShortcut(keydown(document.body, init))).toBe(
          true,
        );
      },
    );

    it('ignores keys typed into fields', () => {
      expect(shouldIgnoreGlobalShortcut(keydown(el('<input>')))).toBe(true);
    });

    it('ignores events another handler already consumed', () => {
      const button = el('<button></button>');
      button.addEventListener('keydown', (e) => e.preventDefault());
      expect(shouldIgnoreGlobalShortcut(keydown(button))).toBe(true);
    });

    it('ignores IME composition', () => {
      expect(
        shouldIgnoreGlobalShortcut(
          keydown(document.body, { isComposing: true }),
        ),
      ).toBe(true);
    });
  });
});
