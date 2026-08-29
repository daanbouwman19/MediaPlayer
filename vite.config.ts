import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const target = process.env.VITE_TARGET || 'server'; // default to server if not specified

  if (target === 'main') {
    return {
      build: {
        outDir: 'out/main',
        ssr: true,
        minify: 'esbuild',
        sourcemap: 'hidden',
        emptyOutDir: true,
        lib: {
          entry: {
            index: resolve(import.meta.dirname, 'src/main/main.ts'),
            'database-worker': resolve(
              import.meta.dirname,
              'src/main/database-worker.ts',
            ),
            'scan-worker': resolve(
              import.meta.dirname,
              'src/core/media/scan-worker.ts',
            ),
          },
          formats: ['es'],
        },
        rollupOptions: {
          external: [
            /^electron(\/.*)?$/,
            'node:sqlite',
            'ffmpeg-static',
            /^node:/,
            'express',
            'cors',
            'dotenv',
            /^electron-log/,
          ],
          output: {
            entryFileNames: '[name].js',
          },
        },
      },
      ssr: {
        noExternal: ['execa', 'p-queue', 'range-parser'],
      },
    } as UserConfig;
  }

  if (target === 'preload') {
    return {
      build: {
        outDir: 'out/preload',
        ssr: true,
        minify: 'esbuild',
        sourcemap: 'hidden',
        emptyOutDir: true,
        lib: {
          entry: {
            preload: resolve(import.meta.dirname, 'src/preload/preload.ts'),
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
    } as UserConfig;
  }

  if (target === 'renderer') {
    return {
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
            index: resolve(import.meta.dirname, 'index.html'),
          },
        },
      },
      resolve: {
        alias: {
          '@': resolve(import.meta.dirname, 'src/renderer'),
        },
      },
    } as UserConfig;
  }

  if (target === 'server') {
    return {
      build: {
        outDir: 'dist/server',
        ssr: true,
        lib: {
          entry: {
            index: resolve(import.meta.dirname, 'src/server/main.ts'),
            worker: resolve(
              import.meta.dirname,
              'src/core/database/database-worker.ts',
            ),
            'scan-worker': resolve(
              import.meta.dirname,
              'src/core/media/scan-worker.ts',
            ),
          },
          formats: ['es'],
        },
        rollupOptions: {
          output: {
            entryFileNames: '[name].js',
          },
          external: [
            /^node:/,
            'node:sqlite',
            'express',
            'cors',
            'ffmpeg-static',
            'dotenv',
          ],
        },
        minify: 'esbuild',
        sourcemap: 'hidden',
      },
    } as UserConfig;
  }

  if (target === 'client') {
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
        https: {
          key: resolve(import.meta.dirname, 'certs/server.key'),
          cert: resolve(import.meta.dirname, 'certs/server.cert'),
        },
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
          '@': resolve(import.meta.dirname, 'src/renderer'),
        },
      },
      build: {
        target: 'es2020',
        sourcemap: mode === 'production' ? 'hidden' : true,
        outDir: 'dist/client',
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          input: {
            index: resolve(import.meta.dirname, 'index.html'),
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
    } as UserConfig;
  }

  return {} as UserConfig;
});
