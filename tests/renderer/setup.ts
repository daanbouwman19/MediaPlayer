import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */

beforeEach(() => {
  setActivePinia(createPinia());
});

// Mock localStorage with existence check for robustness
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    get length() {
      return Object.keys(store).length;
    },
  };
})();

// Helper to safely stub global properties
const stubGlobalSafely = (prop: string, value: any) => {
  if (typeof window !== 'undefined') {
    // In happy-dom/jsdom, we might need to override existing but broken/partial implementations
    try {
      vi.stubGlobal(prop, value);
    } catch (e) {
      // Fallback for environments where stubGlobal fails
      (window as any)[prop] = value;
    }
  } else {
    vi.stubGlobal(prop, value);
  }
};

stubGlobalSafely('localStorage', localStorageMock);

// Streamlined asynchronous requestAnimationFrame polyfill
const rafMock = (cb: FrameRequestCallback) =>
  setTimeout(() => {
    cb(typeof performance !== 'undefined' ? performance.now() : Date.now());
  }, 0);

const cafMock = (id: any) => clearTimeout(id);

stubGlobalSafely('requestAnimationFrame', rafMock);
stubGlobalSafely('cancelAnimationFrame', cafMock);

// Ensure window properties are also set if window exists but properties don't
if (typeof window !== 'undefined') {
  if (!window.requestAnimationFrame) {
    (window as any).requestAnimationFrame = rafMock;
  }
  if (!window.cancelAnimationFrame) {
    (window as any).cancelAnimationFrame = cafMock;
  }
  // Force override localStorage in case it exists but is non-functional
  (window as any).localStorage = localStorageMock;
}
