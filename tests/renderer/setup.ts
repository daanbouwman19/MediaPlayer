import { vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */

beforeEach(() => {
  setActivePinia(createPinia());
});

// Global mock for pinia's storeToRefs to behave like Vue's toRefs in tests.
// This is necessary because test stores are plain reactive objects, not real
// Pinia store instances, so the real storeToRefs would skip non-ref properties.
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: any) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { toRefs, isReactive, reactive } = require('vue');
      return toRefs(isReactive(store) ? store : reactive(store));
    },
  };
});

// Synchronous requestAnimationFrame stub with recursion guard.
// Executes the callback immediately so tests don't need to advance timers.
let rafDepth = 0;
const rafStub = (cb: FrameRequestCallback): number => {
  if (rafDepth > 10) {
    // Prevent infinite recursion in animation loops by deferring.
    return setTimeout(() => {
      try {
        cb(Date.now());
      } catch {
        // Swallow errors during environment disposal.
      }
    }, 0) as unknown as number;
  }
  rafDepth++;
  try {
    cb(Date.now());
  } catch (err) {
    // Swallow disposal-related errors that occur after the test environment
    // has been torn down (e.g. recursive RAF loops or late canvas calls).
    if (
      (err instanceof ReferenceError &&
        err.message.includes('requestAnimationFrame')) ||
      (err instanceof Error &&
        (err.message.includes('canvas') || err.message.includes('context')))
    ) {
      return 1;
    }
    throw err;
  } finally {
    rafDepth--;
  }
  return 1;
};

const cafStub = (id: number) => {
  if (id > 1) {
    clearTimeout(id);
  }
};

// happy-dom's localStorage is non-functional in this configuration
// (node warns about --localstorage-file), so we provide a simple in-memory mock.
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

vi.stubGlobal('localStorage', localStorageMock);

vi.stubGlobal('requestAnimationFrame', rafStub);
vi.stubGlobal('cancelAnimationFrame', cafStub);
