import { defineConfig } from 'vite-plus';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';

const EXCLUDED = [
  'node_modules',
  'out',
  'release',
  '.vite',
  'dist',
  'tests/e2e/**',
  'coverage/**',
  'cache/**',
];

const NODE_TESTS = [
  'tests/main/**/*.{test,spec}.{js,ts}',
  'tests/server/**/*.{test,spec}.{js,ts}',
  'tests/core/**/*.{test,spec}.{js,ts}',
  'tests/**/*.node.test.ts',
];

export default defineConfig({
  plugins: [vue()],
  test: {
    // Main-process, server and core tests run in Node; everything else
    // (renderer and component tests) runs in happy-dom.
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: NODE_TESTS,
          exclude: EXCLUDED,
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['tests/**/*.{test,spec}.{js,ts}'],
          exclude: [...EXCLUDED, ...NODE_TESTS],
        },
      },
    ],
    setupFiles: ['tests/renderer/setup.ts'],
    globals: true,
    silent: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      all: false,
      include: [
        'src/main/**/*.{js,ts}',
        'src/renderer/**/*.{js,ts}',
        'src/renderer/**/*.vue',
        'src/core/**/*.{js,ts}',
        'src/server/**/*.{js,ts}',
      ],
      exclude: [
        'src/main/main.ts',
        'src/preload/**',
        'src/renderer/renderer.ts',
        '**/*.{test,spec}.{js,ts}',
        'src/renderer/components/icons/**',
      ],
      reportsDirectory: './coverage',
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src/renderer'),
    },
  },
});
