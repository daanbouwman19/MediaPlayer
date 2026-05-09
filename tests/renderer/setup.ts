import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */
beforeEach(() => {
  setActivePinia(createPinia());
});

// happy-dom usually provides localStorage, but Vitest might warn about --localstorage-file.
// We only keep the bare minimum globals that the components strictly require and aren't provided by the env.
// The Pinia store migration (createTestingPinia) handles most logic mocking now.

// SILENCE --localstorage-file WARNING: 
// In Node 25+, use of localStorage without --localstorage-file=path issues a warning.
// We suppress this by providing a functional mock that takes precedence over Node's native one
// or happy-dom's non-functional one.
if (typeof window !== 'undefined') {
  const store: Record<string, string> = {};
  const localStorageMock = {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { for (const key in store) delete store[key]; }),
    key: vi.fn((i: number) => Object.keys(store)[i] || null),
    get length() { return Object.keys(store).length; }
  };
  
  // Use Object.defineProperty to ensure our mock is used even if the property is read-only
  Object.defineProperty(window, 'localStorage', { 
    value: localStorageMock, 
    configurable: true, 
    enumerable: true,
    writable: true 
  });
  
  // Also stub global localStorage for direct access
  vi.stubGlobal('localStorage', localStorageMock);

  // Minimal async rAF polyfill for components that use it (like VR)
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0) as any;
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
}
