import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'out/preload',
    ssr: true,
    minify: 'esbuild',
    sourcemap: 'hidden',
    emptyOutDir: true,
    lib: {
      entry: {
        preload: resolve(__dirname, 'src/preload/preload.ts'),
      },
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [/^electron(\/.*)?$/, /^node:/],
      output: {
        entryFileNames: '[name].cjs',
      },
    },
  },
});
