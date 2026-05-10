import { beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */
beforeEach(() => {
  setActivePinia(createPinia());
});

if (typeof window !== 'undefined') {
  // Minimal async rAF polyfill for components that use it (like VR)
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) =>
      setTimeout(() => cb(performance.now()), 0) as any;
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
}
