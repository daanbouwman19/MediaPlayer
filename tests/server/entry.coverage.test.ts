import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from 'vite-plus/test';
import path from 'path';

const originalArgv = [...process.argv];
const originalEnv = { ...process.env };

const { serverMock, httpsMock, certificatesMock, createAppMock } = vi.hoisted(
  () => {
    const server = {
      setTimeout: vi.fn(),
      setSecureContext: vi.fn(),
      on: vi.fn(),
      listen: vi.fn((_port: number, _host: string, cb: () => void) => {
        cb();
      }),
    };

    return {
      serverMock: server,
      httpsMock: {
        createServer: vi.fn(() => server),
      },
      certificatesMock: {
        ensureCertificates: vi.fn(),
        resolveCertDir: vi.fn(() => '/certs'),
        CERT_RENEWAL_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000,
      },
      createAppMock: vi.fn(
        async () => ((_req: any, res: any) => res.end()) as any,
      ),
    };
  },
);

vi.mock('https', () => ({
  default: httpsMock,
  ...httpsMock,
}));

vi.mock('../../src/server/certificates.ts', () => certificatesMock);

vi.mock('../../src/server/app.ts', () => ({
  createApp: createAppMock,
}));

// Signal handlers are covered in lifecycle.test.ts; keep them off this process.
vi.mock('../../src/server/lifecycle.ts', () => ({
  installServerLifecycle: vi.fn(),
}));

describe('Server entry coverage', () => {
  const credentials = { key: Buffer.from('key'), cert: Buffer.from('cert') };

  beforeEach(() => {
    vi.clearAllMocks();
    certificatesMock.ensureCertificates.mockResolvedValue(credentials);
    delete process.env.HOST;
    delete process.env.GLOBAL_PASSWORD;
    delete process.env.SYSTEM_USER;
    delete process.env.SYSTEM_PASSWORD;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('bootstrap serves HTTPS with the ensured certificates', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(certificatesMock.ensureCertificates).toHaveBeenCalledWith({
      certDir: '/certs',
      host: '127.0.0.1',
    });
    expect(httpsMock.createServer).toHaveBeenCalledWith(
      credentials,
      expect.any(Function),
    );
    expect(serverMock.listen).toHaveBeenCalledWith(
      3000,
      '127.0.0.1',
      expect.any(Function),
    );
  });

  describe('daily certificate check', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const renewed = {
      key: Buffer.from('renewed key'),
      cert: Buffer.from('renewed cert'),
    };

    async function bootstrapWithFakeIntervals() {
      vi.resetModules();
      process.argv[1] = 'vitest';
      const { bootstrap } = await import('../../src/server/main.ts');
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      await bootstrap();
    }

    it('swaps in a renewed certificate without a restart', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
      certificatesMock.ensureCertificates
        .mockResolvedValueOnce(credentials)
        .mockResolvedValue(renewed);

      await bootstrapWithFakeIntervals();
      expect(serverMock.setSecureContext).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(DAY_MS);

      expect(certificatesMock.ensureCertificates).toHaveBeenCalledTimes(2);
      expect(certificatesMock.ensureCertificates).toHaveBeenLastCalledWith({
        certDir: '/certs',
        host: '127.0.0.1',
        quiet: true,
      });
      expect(serverMock.setSecureContext).toHaveBeenCalledTimes(1);
      expect(serverMock.setSecureContext).toHaveBeenCalledWith(renewed);

      // The renewed certificate is now the current one.
      await vi.advanceTimersByTimeAsync(DAY_MS);
      expect(certificatesMock.ensureCertificates).toHaveBeenCalledTimes(3);
      expect(serverMock.setSecureContext).toHaveBeenCalledTimes(1);
    });

    it('keeps the secure context while the certificate is unchanged', async () => {
      // Equal contents, different Buffer instances (re-read from disk).
      certificatesMock.ensureCertificates.mockResolvedValue({
        key: Buffer.from('key'),
        cert: Buffer.from('cert'),
      });

      await bootstrapWithFakeIntervals();
      await vi.advanceTimersByTimeAsync(DAY_MS);

      expect(certificatesMock.ensureCertificates).toHaveBeenCalledTimes(2);
      expect(serverMock.setSecureContext).not.toHaveBeenCalled();
    });

    it('logs a failed check and keeps serving the current certificate', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      const error = new Error('EACCES');
      certificatesMock.ensureCertificates
        .mockResolvedValueOnce(credentials)
        .mockRejectedValueOnce(error)
        .mockResolvedValue(renewed);

      await bootstrapWithFakeIntervals();
      await vi.advanceTimersByTimeAsync(DAY_MS);

      expect(errorSpy).toHaveBeenCalledWith(
        'Certificate renewal failed:',
        error,
      );
      expect(serverMock.setSecureContext).not.toHaveBeenCalled();

      // The next day's check still runs.
      await vi.advanceTimersByTimeAsync(DAY_MS);
      expect(serverMock.setSecureContext).toHaveBeenCalledWith(renewed);
    });

    it('stops checking once the server is closed', async () => {
      await bootstrapWithFakeIntervals();

      const onClose = serverMock.on.mock.calls.find(
        ([event]) => event === 'close',
      )?.[1] as (() => void) | undefined;
      expect(onClose).toBeTypeOf('function');
      onClose?.();
      await vi.advanceTimersByTimeAsync(DAY_MS);

      expect(certificatesMock.ensureCertificates).toHaveBeenCalledTimes(1);
    });
  });

  it('bootstrap does not set an idle socket timeout', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(serverMock.setTimeout).not.toHaveBeenCalled();
  });

  it('bootstrap warns when a non-loopback HOST has no authentication', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';
    process.env.HOST = '0.0.0.0';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('no authentication is configured'),
    );
    expect(serverMock.listen).toHaveBeenCalledWith(
      3000,
      '0.0.0.0',
      expect.any(Function),
    );
  });

  it('bootstrap does not warn when authentication is configured', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';
    process.env.HOST = '0.0.0.0';
    process.env.GLOBAL_PASSWORD = 'secret';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('applyDefaultNodeEnv defaults the built bundle to production', async () => {
    const { applyDefaultNodeEnv } = await import('../../src/server/main.ts');

    delete process.env.NODE_ENV;
    applyDefaultNodeEnv('file:///app/dist/server/index.js');
    expect(process.env.NODE_ENV).toBe('production');
  });

  it('applyDefaultNodeEnv keeps the development default for the sources', async () => {
    const { applyDefaultNodeEnv } = await import('../../src/server/main.ts');

    delete process.env.NODE_ENV;
    applyDefaultNodeEnv('file:///repo/src/server/main.ts');
    expect(process.env.NODE_ENV).toBeUndefined();
  });

  it('applyDefaultNodeEnv never overrides an explicit NODE_ENV', async () => {
    const { applyDefaultNodeEnv } = await import('../../src/server/main.ts');

    process.env.NODE_ENV = 'development';
    applyDefaultNodeEnv('file:///app/dist/server/index.js');
    expect(process.env.NODE_ENV).toBe('development');
  });

  it('bootstrap respects PORT environment variable', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';
    process.env.PORT = '4000';

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(serverMock.listen).toHaveBeenCalledWith(
      4000,
      expect.any(String),
      expect.any(Function),
    );
  });

  it.each([
    'invalid',
    '0',
    '-1',
    '65536', // Test upper bound
  ])(
    'bootstrap uses default port when PORT is invalid (%s)',
    async (invalidPort) => {
      vi.resetModules();
      process.argv[1] = 'vitest';
      process.env.PORT = invalidPort;
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const { bootstrap } = await import('../../src/server/main.ts');

      await bootstrap();

      expect(serverMock.listen).toHaveBeenCalledWith(
        3000, // DEFAULT_SERVER_PORT
        expect.any(String),
        expect.any(Function),
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid PORT'),
      );
    },
  );

  it('bootstrap throws on certificate errors', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    const error = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    certificatesMock.ensureCertificates.mockRejectedValue(error);

    const { bootstrap } = await import('../../src/server/main.ts');

    await expect(bootstrap()).rejects.toBe(error);
    expect(httpsMock.createServer).not.toHaveBeenCalled();
  });

  it('server entry does not auto-bootstrap when not entry file', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    const bootstrapMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/server/main.ts', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../src/server/main.ts')>();
      return {
        ...actual,
        bootstrap: bootstrapMock,
      };
    });

    await import('../../src/server/server.ts');

    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it('server entry does not auto-bootstrap when argv entry is missing', async () => {
    vi.resetModules();
    process.argv[1] = '';

    const bootstrapMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/server/main.ts', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../src/server/main.ts')>();
      return {
        ...actual,
        bootstrap: bootstrapMock,
      };
    });

    await import('../../src/server/server.ts');

    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it('server entry bootstraps when entry file matches', async () => {
    vi.resetModules();
    process.argv[1] = path.resolve(process.cwd(), 'src', 'server', 'server.ts');

    const bootstrapMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../src/server/main.ts', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../src/server/main.ts')>();
      return {
        ...actual,
        bootstrap: bootstrapMock,
      };
    });

    await import('../../src/server/server.ts');

    expect(bootstrapMock).toHaveBeenCalled();
  });

  it('server entry logs and exits when bootstrap fails', async () => {
    vi.resetModules();
    process.argv[1] = path.resolve(process.cwd(), 'src', 'server', 'server.ts');

    const bootstrapMock = vi.fn().mockRejectedValue(new Error('boom'));
    vi.doMock('../../src/server/main.ts', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../src/server/main.ts')>();
      return {
        ...actual,
        bootstrap: bootstrapMock,
      };
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    try {
      await import('../../src/server/server.ts');

      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
      expect(errorSpy).toHaveBeenCalledWith(
        'Failed to start server:',
        expect.any(Error),
      );
    } finally {
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('main entry does not auto-bootstrap when argv entry is missing', async () => {
    vi.resetModules();
    process.argv[1] = '';

    vi.doMock('../../src/server/main.ts', async (importOriginal) => {
      return await importOriginal();
    });

    const { shouldAutoBootstrap } = await import('../../src/server/main.ts');

    expect(shouldAutoBootstrap(process.argv[1])).toBe(false);
  });

  it('main entry bootstraps when entry file matches', async () => {
    vi.resetModules();
    process.argv[1] = path.resolve(process.cwd(), 'src', 'server', 'main.ts');

    vi.doMock('../../src/server/main.ts', async (importOriginal) => {
      return await importOriginal();
    });

    const { shouldAutoBootstrap } = await import('../../src/server/main.ts');

    expect(shouldAutoBootstrap(process.argv[1])).toBe(true);
  });
});
