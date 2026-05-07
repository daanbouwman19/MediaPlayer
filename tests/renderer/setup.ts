import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */

beforeEach(() => {
  setActivePinia(createPinia());
});

// Mock localStorage
const localStorageMock = (function () {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    key: vi.fn((index: number) => Object.keys(store)[index] || null),
    get length() {
      return Object.keys(store).length;
    },
  };
})();

// Centralize RAF stubs for tests
let rafDepth = 0;
const rafStub = (cb: FrameRequestCallback) => {
  if (rafDepth > 10) {
    // Prevent infinite recursion in animation loops.
    // Use setTimeout but wrap in safety to avoid ReferenceErrors if the environment is torn down.
    return setTimeout(() => {
      try {
        // Just call it, the try-catch will handle ReferenceErrors if disposal happened
        cb(Date.now());
      } catch {
        // Catch ReferenceErrors during environment disposal
      }
    }, 0);
  }
  rafDepth++;
  try {
    cb(Date.now());
  } catch (err) {
    // If it's a ReferenceError about requestAnimationFrame, it's likely disposal related
    if (
      err instanceof ReferenceError &&
      err.message.includes('requestAnimationFrame')
    ) {
      return 1;
    }
    // Also ignore "canvas is not defined" or similar if happening in a late loop after disposal
    if (
      err instanceof Error &&
      (err.message.includes('canvas') || err.message.includes('context'))
    ) {
      return 1;
    }
    throw err;
  } finally {
    rafDepth--;
  }
  return 1;
};

const cafStub = (id: any) => {
  if (typeof id === 'number' && id > 1) {
    clearTimeout(id);
  }
};

// Define on all possible global targets to ensure visibility in all environments
const globalTargets: any[] = [
  typeof globalThis !== 'undefined' ? globalThis : null,
  typeof global !== 'undefined' ? global : null,
  typeof window !== 'undefined' ? window : null,
  typeof self !== 'undefined' ? self : null,
].filter((t) => t !== null);

globalTargets.forEach((target) => {
  try {
    // Check if we can define property
    const descriptor = Object.getOwnPropertyDescriptor(
      target,
      'requestAnimationFrame',
    );
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(target, 'requestAnimationFrame', {
        value: rafStub,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      Object.defineProperty(target, 'cancelAnimationFrame', {
        value: cafStub,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      Object.defineProperty(target, 'localStorage', {
        value: localStorageMock,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      // Fallback to direct assignment
      target.requestAnimationFrame = rafStub;
      target.cancelAnimationFrame = cafStub;
      target.localStorage = localStorageMock;
    }
  } catch {
    // Ignore errors for frozen objects
  }
});

// Also use Vitest's stubGlobal for best compatibility with its internal systems
try {
  vi.stubGlobal('requestAnimationFrame', rafStub);
  vi.stubGlobal('cancelAnimationFrame', cafStub);
  vi.stubGlobal('localStorage', localStorageMock);
} catch {
  // Ignore if vi.stubGlobal is not available
}

// Export for use in tests if needed
export { localStorageMock, rafStub, cafStub };
