import { beforeEach } from 'vite-plus/test';
import { setActivePinia, createPinia } from 'pinia';

process.env.GLOBAL_PASSWORD = '';

/**
 * Global setup for renderer tests.
 */
beforeEach(() => {
  setActivePinia(createPinia());
  // Stores persist these settings; don't let one test's choices leak into
  // the next test's fresh store.
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('slideshowSettings');
    localStorage.removeItem('privacySettings');
  }
});

if (typeof window !== 'undefined') {
  // Minimal async rAF polyfill for components that use it (like VR)
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (cb) =>
      setTimeout(() => cb(performance.now()), 0) as any;
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
}
