import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['tests/main/**', 'node'],
      ['tests/server/**', 'node'],
      ['tests/core/**', 'node'],
      ['**/*.node.test.ts', 'node'],
    ],
    setupFiles: ['tests/renderer/setup.ts'],
    globals: true,
    silent: true,
    testTimeout: 10000,
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: [
      'node_modules',
      'out',
      'release',
      '.vite',
      'dist',
      'tests/e2e/**',
      'coverage/**',
      'cache/**',
    ],
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
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
});
