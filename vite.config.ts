import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const isServer = mode === 'server';

  if (isServer) {
    // Server build configuration
    return {
      build: {
        outDir: 'dist/server',
        ssr: true,
        lib: {
          entry: {
            index: resolve(__dirname, 'src/server/main.ts'),
            worker: resolve(__dirname, 'src/core/database-worker.ts'),
            'scan-worker': resolve(__dirname, 'src/core/scan-worker.ts'),
          },
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            entryFileNames: '[name].js',
          },
          external: [
            /^node:/,
            'better-sqlite3',
            'express',
            'cors',
            'ffmpeg-static',
            'dotenv',
          ],
        },
        minify: 'esbuild',
        sourcemap: 'hidden',
      },
    };
  }

  // Frontend build configuration
  return {
    plugins: [
      vue(),
      tailwindcss(),
      visualizer({
        filename: './dist/stats.html',
        open: false,
      }),
    ],
    root: '.',
    server: {
      watch: {
        ignored: ['**/coverage/**', '**/cache/**'],
      },
      clearScreen: false,
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: 'https://127.0.0.1:3000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer'),
      },
    },
    build: {
      target: 'es2020',
      sourcemap: mode === 'production' ? 'hidden' : true,
      outDir: 'dist/client',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('node_modules/three/')) {
                return 'three';
              }
              if (id.includes('node_modules/vue')) {
                return 'vue';
              }
              return 'vendor';
            }
          },
        },
      },
    },
  };
});
