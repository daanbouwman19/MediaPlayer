import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import path from 'path';

const originalArgv = [...process.argv];
const originalEnv = { ...process.env };

const { fsMock, serverMock, httpsMock, selfsignedMock, createAppMock } =
  vi.hoisted(() => {
    const server = {
      setTimeout: vi.fn(),
      listen: vi.fn((_port: number, _host: string, cb: () => void) => {
        cb();
      }),
    };

    return {
      fsMock: {
        access: vi.fn(),
        readFile: vi.fn(),
        mkdir: vi.fn(),
        writeFile: vi.fn(),
      },
      serverMock: server,
      httpsMock: {
        createServer: vi.fn(() => server),
      },
      selfsignedMock: {
        generate: vi.fn(),
      },
      createAppMock: vi.fn(
        async () => ((_req: any, res: any) => res.end()) as any,
      ),
    };
  });

vi.mock('fs/promises', () => ({
  default: fsMock,
  ...fsMock,
}));

vi.mock('https', () => ({
  default: httpsMock,
  ...httpsMock,
}));

vi.mock('selfsigned', () => ({
  default: selfsignedMock,
  ...selfsignedMock,
}));

vi.mock('../../src/server/app.ts', () => ({
  createApp: createAppMock,
}));

describe('Server entry coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMock.readFile.mockResolvedValue('cert');
    fsMock.access.mockResolvedValue(undefined);
    selfsignedMock.generate.mockResolvedValue({ cert: 'cert', private: 'key' });
  });

  afterEach(() => {
    process.argv = [...originalArgv];
    process.env = { ...originalEnv };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('bootstrap uses existing certificates', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(fsMock.access).toHaveBeenCalled();
    expect(selfsignedMock.generate).not.toHaveBeenCalled();
    expect(httpsMock.createServer).toHaveBeenCalled();
    expect(serverMock.listen).toHaveBeenCalled();
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

  it('bootstrap generates certificates when missing', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    fsMock.access.mockRejectedValue({ code: 'ENOENT' });

    const { bootstrap } = await import('../../src/server/main.ts');

    await bootstrap();

    expect(fsMock.mkdir).toHaveBeenCalled();
    expect(selfsignedMock.generate).toHaveBeenCalled();
    expect(fsMock.writeFile).toHaveBeenCalledTimes(2);
    expect(serverMock.listen).toHaveBeenCalled();
  });

  it('bootstrap throws on unexpected certificate errors', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    fsMock.access.mockRejectedValue({ code: 'EACCES' });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { bootstrap } = await import('../../src/server/main.ts');

    await expect(bootstrap()).rejects.toBeDefined();
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('server entry does not auto-bootstrap when not entry file', async () => {
    vi.resetModules();
    process.argv[1] = 'vitest';

    const bootstrapMock = vi.fn();
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

    const bootstrapMock = vi.fn();
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

    const bootstrapMock = vi.fn();
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
