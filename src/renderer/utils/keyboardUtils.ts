/**
 * @file Shared guards for window/document-level keyboard shortcuts.
 *
 * Global shortcut handlers (App.vue, MediaDisplay.vue) must not steal keys
 * from controls that use them (text fields, selects, range inputs), must not
 * block the native Space/Enter activation of focused buttons, links and
 * ARIA widgets, must stay out of open modal dialogs, and must leave browser
 * and OS chords (Ctrl/Cmd/Alt + key) alone.
 */

/**
 * Elements whose default Space/Enter behaviour is to activate themselves.
 * A global Space shortcut must not preventDefault on these.
 */
const ACTIVATABLE_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="treeitem"]',
].join(',');

/**
 * True when the key event targets an element that consumes keys itself:
 * inputs (including range sliders and checkboxes), textareas, selects and
 * contenteditable regions.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

/**
 * True when the target activates on Space/Enter (buttons, links, ARIA
 * buttons/checkboxes/tabs...), so a global Space shortcut must let the
 * browser perform that activation instead.
 */
export function isActivatableTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.matches(ACTIVATABLE_SELECTOR);
}

/**
 * True while any modal dialog (lock screen, settings modals, shortcuts
 * overlay...) is rendered. Every modal in the app is a v-if'd element with
 * aria-modal="true", so the DOM is the single source of truth.
 */
export function isModalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/**
 * True while a Ctrl/Cmd/Alt chord is held. AltGr, which Windows reports as
 * Ctrl+Alt, only selects a character on many keyboard layouts, so it does
 * not count as a chord.
 */
function isModifierChord(event: KeyboardEvent): boolean {
  if (event.metaKey) return true;
  if (event.ctrlKey && event.altKey && event.getModifierState('AltGraph')) {
    return false;
  }
  return event.ctrlKey || event.altKey;
}

/**
 * True when a global shortcut handler should ignore the event entirely:
 * something already handled it, an IME composition is in progress, a
 * Ctrl/Cmd/Alt chord is held (browser/OS shortcuts such as Alt+ArrowLeft or
 * Ctrl+Z), or the key is being typed into an editable control. Shift is
 * deliberately not a reason to ignore: '?' is typed with Shift.
 */
export function shouldIgnoreGlobalShortcut(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    isModifierChord(event) ||
    isEditableTarget(event.target)
  );
}
