import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */
beforeEach(() => {
  setActivePinia(createPinia());
});

// Provide minimal mocks for missing browser globals in the test environment (happy-dom/jsdom).
// We check for existence first to avoid overriding functional native implementations.

if (typeof window !== 'undefined') {
  // localStorage polyfill for environments where it's non-functional or missing
  if (!window.localStorage || typeof window.localStorage.getItem !== 'function') {
    const store: Record<string, string> = {};
    const localStorageMock = {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
      clear: vi.fn(() => { for (const key in store) delete store[key]; }),
      key: vi.fn((i: number) => Object.keys(store)[i] || null),
      get length() { return Object.keys(store).length; }
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, configurable: true });
  }

  // requestAnimationFrame polyfill
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as any;
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
}
