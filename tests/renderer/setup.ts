import { beforeEach } from 'vite-plus/test';
import { setActivePinia, createPinia } from 'pinia';
import fs from 'fs';
import os from 'os';
import path from 'path';

process.env.GLOBAL_PASSWORD = '';
// Code under test that encrypts (e.g. the media caches) creates a master key
// on first use: keep it out of the working directory.
if (!process.env.MASTER_KEY_DIR) {
  process.env.MASTER_KEY_DIR = path.join(os.tmpdir(), 'mediaplayer-test-keys');
  fs.mkdirSync(process.env.MASTER_KEY_DIR, { recursive: true });
}

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
