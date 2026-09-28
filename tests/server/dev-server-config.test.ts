import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
  vi,
} from 'vite-plus/test';
import { createServer, type ViteDevServer } from 'vite-plus';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import { fileURLToPath } from 'url';
import config, { devServerFsDeny, relaxCspForDev } from '../../vite.config';

vi.mock('vite-plus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vite-plus')>();
  return {
    ...actual,
    // Only process.env counts in these tests, not a developer's own .env
    // file in the project root (e.g. one with HOST=0.0.0.0).
    loadEnv: (mode: string, envDir: string, prefixes?: string | string[]) =>
      actual.loadEnv(mode, `${envDir}/.no-env-files`, prefixes),
  };
});

function parseMetaCsp(html: string): Record<string, string[]> {
  const content =
    /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)?.[1];
  if (!content) throw new Error('No CSP meta tag');
  const directives: Record<string, string[]> = {};
  for (const directive of content.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/);
    if (name) directives[name] = sources;
  }
  return directives;
}

describe('index.html Content Security Policy', () => {
  let html: string;

  beforeAll(async () => {
    html = await fs.readFile(path.resolve('index.html'), 'utf8');
  });

  it('allows no inline or eval script in the production policy', () => {
    const csp = parseMetaCsp(html);
    expect(csp['script-src']).toEqual(["'self'"]);
  });

  it('allows no websockets in the production policy', () => {
    const csp = parseMetaCsp(html);
    expect(csp['connect-src']).toContain("'self'");
    expect(csp['connect-src']).not.toContain('ws:');
    expect(csp['connect-src']?.some((src) => src.startsWith('ws'))).toBe(false);
  });

  it('allows the blob: worker hls.js uses for transmuxing', () => {
    expect(parseMetaCsp(html)['worker-src']).toEqual(["'self'", 'blob:']);
  });

  it('adds only the HMR websocket for the dev servers', () => {
    const production = parseMetaCsp(html);
    const dev = parseMetaCsp(relaxCspForDev(html));

    expect(new Set(dev['connect-src'])).toEqual(
      new Set([...(production['connect-src'] ?? []), 'ws:', 'wss:']),
    );
    expect(dev['script-src']).toEqual(production['script-src']);
  });

  it('fails loudly when index.html has no CSP to relax', () => {
    expect(() => relaxCspForDev('<html></html>')).toThrow(
      'no Content-Security-Policy',
    );
  });
});

describe('dev server targets', () => {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  const originalEnv = {
    VITE_TARGET: process.env.VITE_TARGET,
    HOST: process.env.HOST,
  };

  afterEach(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  function devServerConfig(target: 'client' | 'renderer') {
    process.env.VITE_TARGET = target;
    return config({ mode: 'development', command: 'serve' }).server;
  }

  it.each(['client', 'renderer'] as const)(
    'binds the %s dev server to loopback when HOST is unset',
    (target) => {
      delete process.env.HOST;
      expect(devServerConfig(target)?.host).toBe('127.0.0.1');
    },
  );

  it.each(['client', 'renderer'] as const)(
    'binds the %s dev server to HOST when it is set',
    (target) => {
      process.env.HOST = '0.0.0.0';
      expect(devServerConfig(target)?.host).toBe('0.0.0.0');
    },
  );

  it.each(['client', 'renderer'] as const)(
    'denies the project database, cache and certificates on the %s dev server',
    (target) => {
      delete process.env.HOST;
      expect(devServerConfig(target)?.fs?.deny).toEqual(
        devServerFsDeny(projectRoot),
      );
    },
  );
});

describe('dev server fs.deny', { timeout: 30_000 }, () => {
  let root: string;
  let vite: ViteDevServer;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    // A project root lookalike: web:dev keeps its database, cache and
    // certificates next to index.html.
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mediaplayer vite (dev)-'));
    const files: Record<string, string> = {
      'index.html': '<!doctype html><html><body></body></html>',
      'media-library.db': 'db',
      'media-library.db-wal': 'wal',
      'media-library.db-shm': 'shm',
      'master.key': 'key',
      '.env': 'SESSION_SECRET=x',
      'cache/thumbnails/a.jpg': 'jpg',
      'cache/drive/file.mp4': 'mp4',
      'certs/server.cert': 'cert',
      'certs/server.key': 'key',
      'src/renderer/cache.txt': 'app file',
    };
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), content);
    }

    vite = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      appType: 'custom',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        fs: { deny: devServerFsDeny(root) },
      },
    });
    server = http.createServer(vite.middlewares);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await vite?.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([
    '/media-library.db',
    '/media-library.db-wal',
    '/media-library.db-shm',
    '/master.key',
    '/.env',
    '/cache/thumbnails/a.jpg',
    '/cache/drive/file.mp4',
    '/certs/server.cert',
    '/certs/server.key',
  ])('refuses %s', async (file) => {
    const response = await fetch(`${baseUrl}${file}`);
    expect(response.status).toBe(403);
  });

  it('still serves application files', async () => {
    const response = await fetch(`${baseUrl}/src/renderer/cache.txt`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('app file');
  });
});
