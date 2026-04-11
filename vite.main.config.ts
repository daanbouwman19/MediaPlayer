import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'out/main',
    ssr: true,
    minify: 'esbuild',
    sourcemap: 'hidden',
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(__dirname, 'src/main/main.ts'),
        'database-worker': resolve(__dirname, 'src/main/database-worker.ts'),
        'scan-worker': resolve(__dirname, 'src/core/scan-worker.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        /^electron(\/.*)?$/,
        'better-sqlite3',
        'ffmpeg-static',
        /^node:/,
        'express',
        'cors',
        'dotenv',
        'electron-log/main.js',
      ],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
