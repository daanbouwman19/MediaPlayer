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

const rafMock = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0);

const cafMock = (id: NodeJS.Timeout) => clearTimeout(id);

vi.stubGlobal('requestAnimationFrame', rafMock);
vi.stubGlobal('cancelAnimationFrame', cafMock);

if (typeof window !== 'undefined') {
  window.requestAnimationFrame =
    rafMock as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame =
    cafMock as unknown as typeof window.cancelAnimationFrame;
}
