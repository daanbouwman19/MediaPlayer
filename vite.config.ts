import { defineConfig, loadEnv } from 'vite-plus';
import type { Plugin, UserConfig } from 'vite-plus';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { visualizer as bundleVisualizer } from 'rollup-plugin-visualizer';
import { resolve } from 'path';

/**
 * index.html's meta CSP is the production policy, and the only CSP packaged
 * Electron gets. The dev servers additionally need the HMR websocket, so they
 * add ws:/wss: to connect-src.
 */
export function relaxCspForDev(html: string): string {
  const cspConnectSrc =
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*?\bconnect-src )/;
  if (!cspConnectSrc.test(html)) {
    throw new Error('index.html has no Content-Security-Policy connect-src');
  }
  return html.replace(cspConnectSrc, '$1ws: wss: ');
}

function devCspPlugin(): Plugin {
  return {
    name: 'mediaplayer:dev-csp',
    apply: 'serve',
    transformIndexHtml: relaxCspForDev,
  };
}

// Bracket-escapes glob syntax so a project path is matched literally.
const escapeGlob = (value: string) =>
  value.replace(/[*?()[\]{}!+@]/g, (char) => `[${char}]`);

/**
 * Files the dev servers must not serve although they sit in the project
 * root: the web:dev database, its cache (thumbnails, HLS segments, Drive
 * downloads) and TLS material. Setting server.fs.deny replaces Vite's
 * defaults, so those come first.
 */
export function devServerFsDeny(projectRoot: string): string[] {
  const projectDir = (dir: string) =>
    `${escapeGlob(resolve(projectRoot, dir).replaceAll('\\', '/'))}/**`;
  return [
    '.env',
    '.env.*',
    '*.{crt,pem,key,p12,pfx,cer,der}',
    '.npmrc',
    '.yarnrc.yml',
    '**/.git/**',
    '*.cert',
    '*.db',
    '*.db-wal',
    '*.db-shm',
    '*.db-journal',
    projectDir('cache'),
    projectDir('certs'),
  ];
}

function targetConfig(mode: string): UserConfig {
  const target = process.env.VITE_TARGET || 'server'; // default to server if not specified
  // Same variables (and .env file) as the web server, so HOST and CERT_DIR
  // mean the same thing for both.
  const env = loadEnv(mode, import.meta.dirname, '');
  // The web client dev server stays on loopback unless HOST exposes it, like
  // the backend. The Electron renderer dev server is always loopback.
  const devHost = env.HOST || '127.0.0.1';
  const certDir = env.CERT_DIR
    ? resolve(env.CERT_DIR)
    : resolve(import.meta.dirname, 'certs');

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
        devCspPlugin(),
        visualizer({
          filename: './out/renderer/stats.html',
          open: false,
        }),
      ],
      root: '.',
      base: './',
      server: {
        // Electron loads the renderer from http://localhost:5173 (and
        // electron:dev waits on it), so ignore HOST: a LAN-only HOST set for
        // web mode would leave loopback without a listener.
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        fs: { deny: devServerFsDeny(import.meta.dirname) },
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
        devCspPlugin(),
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
        host: devHost,
        port: 5173,
        fs: { deny: devServerFsDeny(import.meta.dirname) },
        https: {
          key: resolve(certDir, 'server.key'),
          cert: resolve(certDir, 'server.cert'),
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
        // dist/client is served publicly: no source maps in production.
        sourcemap: mode !== 'production',
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

/**
 * The bundle report (stats.html) is only written for analysis builds, e.g.
 * `cross-env ANALYZE=1 npm run _build:renderer`, so it never ends up in the
 * packaged app or the web build.
 */
function visualizer(options: Parameters<typeof bundleVisualizer>[0]) {
  return process.env.ANALYZE === '1' ? bundleVisualizer(options) : false;
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
      // src/core and src/infrastructure are shared by the Electron main
      // process, the web server and the worker threads, so they must not
      // import either entry layer (CLAUDE.md). Drive access from
      // core goes through core/media/drive-backend.ts.
      files: ['src/core/**', 'src/infrastructure/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                regex: '^(\\.\\./)+(main|server)(/|$)',
                message:
                  'src/core and src/infrastructure must not import from src/main or src/server; inject the dependency instead.',
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
