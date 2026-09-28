import { defineConfig } from 'vite-plus';
import type { UserConfig } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

function targetConfig(mode: string): UserConfig {
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
              return undefined;
            },
          },
        },
      },
    } as UserConfig;
  }

  return {} as UserConfig;
}

// Oxlint config (`vp lint` / `vp check`): the `correctness` category (code that
// is outright wrong or useless, including the type-aware rules such as
// no-floating-promises), plus rules that keep `any` out of src/.
const noAnyRules = {
  'typescript/no-explicit-any': 'error',
  'typescript/no-unsafe-argument': 'error',
  'typescript/no-unsafe-assignment': 'error',
  'typescript/no-unsafe-call': 'error',
  'typescript/no-unsafe-member-access': 'error',
  'typescript/no-unsafe-return': 'error',
} as const;

const lint: UserConfig['lint'] = {
  plugins: ['oxc', 'typescript', 'unicorn', 'vue'],
  categories: {
    correctness: 'error',
  },
  options: {
    typeAware: true,
  },
  env: {
    builtin: true,
    browser: true,
    node: true,
    es2024: true,
  },
  ignorePatterns: [
    'dist',
    'out',
    'node_modules',
    'coverage',
    '.vite',
    'release',
    '.cache',
    'cache',
    'dist-server',
    'dist-web',
  ],
  rules: {
    ...noAnyRules,
    'typescript/no-misused-promises': 'error',
    'typescript/switch-exhaustiveness-check': 'error',
    'typescript/only-throw-error': 'error',
    'typescript/prefer-promise-reject-errors': 'error',
    // `new Array(n)` preallocation is intentional in hot paths (see AGENTS.md).
    'unicorn/no-new-array': 'off',
  },
  overrides: [
    {
      // src/core is shared by the Electron main process, the web server and
      // the worker threads, so it must not import either entry layer
      // (CLAUDE.md). Drive access goes through core/media/drive-backend.ts.
      files: ['src/core/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(\\.\\./)+(main|server)(/|$)',
                message:
                  'src/core must not import from src/main or src/server; inject the dependency instead.',
              },
            ],
          },
        ],
      },
    },
    {
      // Tests may use `any` for mocks, pass unbound mock methods to expect(),
      // and `await` synchronous calls (e.g. `await vm.$emit()`) to flush
      // pending microtasks before asserting.
      files: ['tests/**', '__mocks__/**'],
      rules: {
        ...Object.fromEntries(Object.keys(noAnyRules).map((r) => [r, 'off'])),
        'typescript/unbound-method': 'off',
        'typescript/await-thenable': 'off',
      },
    },
  ],
};

// Oxfmt config (run via `vp fmt` / `vp check`). Converted from the former
// .prettierrc.json and .prettierignore.
const fmt: UserConfig['fmt'] = {
  semi: true,
  trailingComma: 'all',
  singleQuote: true,
  printWidth: 80,
  tabWidth: 2,
  sortPackageJson: false,
  ignorePatterns: [
    'build',
    'coverage',
    'dist',
    'node_modules',
    'package-lock.json',
    'yarn.lock',
    '*.log',
    '.cache/',
  ],
};

export default defineConfig(({ mode }) => ({
  ...targetConfig(mode),
  lint,
  fmt,
}));
