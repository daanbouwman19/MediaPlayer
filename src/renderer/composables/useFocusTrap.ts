/**
 * @file Focus management for modal dialogs (role="dialog" aria-modal="true").
 * While a trap is active it moves focus into its container, keeps Tab and
 * Shift+Tab cycling inside it, and when it deactivates it returns focus to the
 * element that had it before (usually the button that opened the dialog).
 */
import {
  onBeforeUnmount,
  toValue,
  watch,
  type MaybeRefOrGetter,
  type Ref,
} from 'vue';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

type ElementRef = Readonly<Ref<HTMLElement | null>>;

interface TrapEntry {
  container: ElementRef;
  returnFocusTo: HTMLElement | null;
}

/**
 * Active traps, innermost last. Only the innermost trap reacts to Tab and
 * focus changes, so a dialog opened on top of another one keeps focus.
 */
const trapStack: TrapEntry[] = [];

const isVisible = (el: HTMLElement): boolean =>
  typeof el.checkVisibility === 'function'
    ? el.checkVisibility({ visibilityProperty: true })
    : true;

/**
 * Returns the elements inside `root` that can receive keyboard focus, in DOM
 * (tab) order.
 */
export function getFocusableElements(root: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) {
    if (!el.closest('[inert]') && isVisible(el)) {
      result.push(el);
    }
  }
  return result;
}

export interface FocusTrapOptions {
  /** Element to focus on activation. Defaults to the first focusable one. */
  initialFocus?: ElementRef;
}

/**
 * Traps keyboard focus inside `container` while `isActive` is true.
 * @param container - Template ref of the dialog element.
 * @param isActive - Whether the dialog is open.
 * @param options - Optional initial focus target.
 */
export function useFocusTrap(
  container: ElementRef,
  isActive: MaybeRefOrGetter<boolean>,
  options: FocusTrapOptions = {},
): void {
  const entry: TrapEntry = { container, returnFocusTo: null };

  const isInnermost = () => trapStack[trapStack.length - 1] === entry;

  const focusFirst = () => {
    const root = container.value;
    if (!root) return;
    const initial = options.initialFocus?.value;
    const target =
      initial && root.contains(initial)
        ? initial
        : getFocusableElements(root)[0];
    target?.focus();
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !isInnermost()) return;
    const root = container.value;
    if (!root) return;

    const focusable = getFocusableElements(root);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    const current = document.activeElement;
    if (!(current instanceof Node) || !root.contains(current)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && current === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Catches focus that leaves the dialog by other means (a click on content
  // behind the backdrop, a hidden last element the Tab handler skipped).
  const handleFocusIn = (event: FocusEvent) => {
    if (!isInnermost()) return;
    const root = container.value;
    if (root && event.target instanceof Node && !root.contains(event.target)) {
      focusFirst();
    }
  };

  /** Set on activation until the (freshly rendered) dialog got focus. */
  let needsInitialFocus = false;

  const activate = () => {
    if (trapStack.includes(entry)) return;
    entry.returnFocusTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    trapStack.push(entry);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('focusin', handleFocusIn);
    needsInitialFocus = true;
  };

  const deactivate = () => {
    needsInitialFocus = false;
    const index = trapStack.indexOf(entry);
    if (index === -1) return;
    trapStack.splice(index, 1);
    document.removeEventListener('keydown', handleKeydown);
    document.removeEventListener('focusin', handleFocusIn);

    const returnTo = entry.returnFocusTo;
    entry.returnFocusTo = null;

    const above = trapStack[index];
    if (above) {
      // A dialog stacked on top of this one is still open and keeps focus.
      // If it would return focus into this (now closing) dialog, send it to
      // wherever this dialog would have returned it instead.
      const root = container.value;
      if (root && above.returnFocusTo && root.contains(above.returnFocusTo)) {
        above.returnFocusTo = returnTo;
      }
      return;
    }

    // Only restore when focus is still in the closing dialog or was dropped
    // to <body>, so focus the app moved elsewhere on purpose is kept.
    const current = document.activeElement;
    const root = container.value;
    const focusIsInDialog =
      !current ||
      current === document.body ||
      (root !== null && root.contains(current));
    if (returnTo?.isConnected && focusIsInDialog) {
      returnTo.focus();
    }
  };

  // Sync flush: the trap must be released the moment the dialog is closed,
  // before any code that runs next moves focus on purpose (and while the
  // dialog element is still rendered).
  watch(
    () => toValue(isActive),
    (active) => {
      if (active) {
        activate();
      } else {
        deactivate();
      }
    },
    { immediate: true, flush: 'sync' },
  );

  // The dialog is usually rendered by a v-if on the same state, so move focus
  // in only once it is in the DOM (post flush, after its template ref is set).
  watch(
    [() => toValue(isActive), container],
    () => {
      if (needsInitialFocus && container.value && isInnermost()) {
        needsInitialFocus = false;
        focusFirst();
      }
    },
    { immediate: true, flush: 'post' },
  );

  onBeforeUnmount(deactivate);
}
