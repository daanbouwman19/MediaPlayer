import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import https from 'https';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const { createAppMock } = vi.hoisted(() => ({
  createAppMock: vi.fn(async () => (_req: any, res: any) => res.end('ok')),
}));

vi.mock('../../src/server/app.ts', () => ({
  createApp: createAppMock,
}));

// Signal handlers are covered in lifecycle.test.ts; keep them off this process.
vi.mock('../../src/server/lifecycle.ts', () => ({
  installServerLifecycle: vi.fn(),
}));

describe('bootstrap HTTPS server', { timeout: 30_000 }, () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];
  let tmpDir: string;
  let server: https.Server | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediaplayer-main-'));
    process.env.CERT_DIR = tmpDir;
    process.argv[1] = 'vitest';
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const createServer = https.createServer.bind(https);
    vi.spyOn(https, 'createServer').mockImplementation(((
      ...args: Parameters<typeof https.createServer>
    ) => {
      server = createServer(...args);
      // Keep the real server object but don't bind a port.
      vi.spyOn(server, 'listen').mockImplementation(function (
        this: https.Server,
        ...listenArgs: unknown[]
      ) {
        const callback = listenArgs.find((arg) => typeof arg === 'function');
        (callback as (() => void) | undefined)?.();
        return this;
      } as never);
      return server;
    }) as typeof https.createServer);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    server = undefined;
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('keeps long-running responses alive (no idle socket timeout)', async () => {
    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(server).toBeDefined();
    // An idle timeout destroys sockets of reindex, scan and heatmap requests
    // that stay silent until their work is done.
    expect(server?.timeout).toBe(0);
    // Slow request senders are still bounded.
    expect(server?.headersTimeout).toBeGreaterThan(0);
    expect(server?.requestTimeout).toBeGreaterThan(0);
  });

  it('serves the certificate generated in CERT_DIR', async () => {
    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    const [key, cert] = await Promise.all([
      fs.readFile(path.join(tmpDir, 'server.key')),
      fs.readFile(path.join(tmpDir, 'server.cert')),
    ]);
    expect(https.createServer).toHaveBeenCalledWith(
      { key, cert },
      expect.any(Function),
    );
  });
});
