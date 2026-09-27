import { describe, it, expect, vi, beforeEach } from 'vite-plus/test';
import { useToast } from '../../../src/renderer/composables/useToast';

describe('useToast', () => {
  const { toasts, add, remove, success, error, info } = useToast();

  beforeEach(() => {
    toasts.value = [];
  });

  it('should add a toast with default type and duration', () => {
    add('Test Message');
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0].message).toBe('Test Message');
    expect(toasts.value[0].type).toBe('info');
  });

  it('should remove a toast by id', () => {
    add('Test Message');
    const id = toasts.value[0].id;
    remove(id);
    expect(toasts.value).toHaveLength(0);
  });

  it('should not remove if id does not exist', () => {
    add('Test Message');
    remove('non-existent-id');
    expect(toasts.value).toHaveLength(1);
  });

  it('should add a success toast', () => {
    success('Success Message');
    expect(toasts.value[0].type).toBe('success');
  });

  it('should add an error toast', () => {
    error('Error Message');
    expect(toasts.value[0].type).toBe('error');
  });

  it('should add an info toast', () => {
    info('Info Message');
    expect(toasts.value[0].type).toBe('info');
  });

  it('should auto-dismiss after duration', () => {
    vi.useFakeTimers();
    add('Auto Dismiss', 'info', 100);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(100);
    expect(toasts.value).toHaveLength(0);
    vi.useRealTimers();
  });
});
