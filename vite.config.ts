import { defineConfig } from 'vite';
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
            index: resolve(__dirname, 'src/main/main.ts'),
            'database-worker': resolve(
              __dirname,
              'src/main/database-worker.ts',
            ),
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
    };
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
    };
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
            index: resolve(__dirname, 'index.html'),
          },
        },
      },
      resolve: {
        alias: {
          '@': resolve(__dirname, 'src/renderer'),
        },
      },
    };
  }

  if (target === 'server') {
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
          key: resolve(__dirname, 'certs/server.key'),
          cert: resolve(__dirname, 'certs/server.cert'),
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
  }

  return {};
});
