import { describe, it, expect, beforeEach } from 'vite-plus/test';
import { installDropGuard } from '../../src/preload/drop-guard';

// Node provides EventTarget/Event; DragEvent's dataTransfer is attached by hand.
function dragEvent(type: string, types: string[]) {
  const event = new Event(type, { cancelable: true });
  const dataTransfer = { types, dropEffect: 'copy' };
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return { event, dataTransfer };
}

describe('installDropGuard (F71)', () => {
  let target: EventTarget;

  beforeEach(() => {
    target = new EventTarget();
    installDropGuard(target as any);
  });

  it.each([['Files'], ['text/uri-list']])(
    'refuses unhandled drops carrying %s',
    (type) => {
      const over = dragEvent('dragover', [type]);
      target.dispatchEvent(over.event);
      expect(over.event.defaultPrevented).toBe(true);
      expect(over.dataTransfer.dropEffect).toBe('none');

      const drop = dragEvent('drop', [type]);
      target.dispatchEvent(drop.event);
      expect(drop.event.defaultPrevented).toBe(true);
    },
  );

  it('leaves drags accepted by a page handler alone', () => {
    const over = dragEvent('dragover', ['Files']);
    over.event.preventDefault(); // e.g. a drop zone's @dragover.prevent
    target.dispatchEvent(over.event);
    expect(over.dataTransfer.dropEffect).toBe('copy');
  });

  it('does not interfere with in-app drags', () => {
    const over = dragEvent('dragover', ['text/plain']);
    target.dispatchEvent(over.event);
    expect(over.event.defaultPrevented).toBe(false);

    const drop = dragEvent('drop', ['text/plain']);
    target.dispatchEvent(drop.event);
    expect(drop.event.defaultPrevented).toBe(false);
  });

  it('ignores events without a dataTransfer', () => {
    const event = new Event('drop', { cancelable: true });
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
