import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    visualizer({
      filename: './out/renderer/stats.html',
      open: false,
    }),
  ],
  root: '.',
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      usePolling: !!process.env.USE_POLLING,
      interval: 100,
    },
  },
  build: {
    outDir: 'out/renderer',
    sourcemap: 'hidden',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
});
