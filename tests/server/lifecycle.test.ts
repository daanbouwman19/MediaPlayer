import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vite-plus/test';
import EventEmitter from 'events';

const { mockCloseDatabase, mockShutdownTranscoding } = vi.hoisted(() => ({
  mockCloseDatabase: vi.fn(),
  mockShutdownTranscoding: vi.fn(),
}));

vi.mock('../../src/core/database/database.ts', () => ({
  closeDatabase: mockCloseDatabase,
}));
vi.mock('../../src/core/media/transcode-queue-manager.ts', () => ({
  shutdownTranscoding: mockShutdownTranscoding,
}));

import {
  installServerLifecycle,
  shutdownServer,
} from '../../src/server/lifecycle.ts';

type FakeServer = EventEmitter & {
  close: Mock<(cb?: (err?: Error) => void) => unknown>;
  closeAllConnections: Mock<() => void>;
};

function createServer(): FakeServer {
  const server = new EventEmitter() as FakeServer;
  server.close = vi.fn((cb?: (err?: Error) => void) => {
    queueMicrotask(() => cb?.());
    return server;
  });
  server.closeAllConnections = vi.fn();
  return server;
}

describe('server lifecycle', () => {
  const handlers = new Map<string, (signal: NodeJS.Signals) => void>();
  let order: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    order = [];
    // Capture the signal handlers instead of registering them on the real
    // process (emitting SIGTERM there would reach the test runner too).
    vi.spyOn(process, 'on').mockImplementation(((
      event: string,
      listener: (signal: NodeJS.Signals) => void,
    ) => {
      handlers.set(event, listener);
      return process;
    }) as any);
    vi.spyOn(process, 'off').mockImplementation(((event: string) => {
      handlers.delete(event);
      return process;
    }) as any);
    mockShutdownTranscoding.mockImplementation(async () => {
      order.push('transcoding');
    });
    mockCloseDatabase.mockImplementation(async () => {
      order.push('database');
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shutdownServer closes the server and ffmpeg before the database', async () => {
    const server = createServer();
    server.close.mockImplementation((cb?: () => void) => {
      queueMicrotask(() => {
        order.push('server');
        cb?.();
      });
      return server;
    });

    await shutdownServer(server);

    expect(server.closeAllConnections).toHaveBeenCalled();
    expect(order).toHaveLength(3);
    expect(order[2]).toBe('database');
  });

  it('shutdownServer works without closeAllConnections', async () => {
    const server = createServer() as any;
    delete server.closeAllConnections;
    await expect(shutdownServer(server)).resolves.toBeUndefined();
  });

  it('SIGTERM shuts down gracefully and exits with 0', async () => {
    const exit = vi.fn();
    const server = createServer();
    installServerLifecycle(server, exit);

    handlers.get('SIGTERM')!('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(server.close).toHaveBeenCalled();
    expect(mockShutdownTranscoding).toHaveBeenCalled();
    expect(mockCloseDatabase).toHaveBeenCalled();
  });

  it('SIGINT is handled the same way, and a second signal exits at once', async () => {
    const exit = vi.fn();
    mockShutdownTranscoding.mockImplementation(() => new Promise(() => {}));
    installServerLifecycle(createServer(), exit);

    handlers.get('SIGINT')!('SIGINT');
    expect(exit).not.toHaveBeenCalled();
    handlers.get('SIGINT')!('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits with 1 when the cleanup fails', async () => {
    const exit = vi.fn();
    mockCloseDatabase.mockRejectedValue(new Error('worker gone'));
    installServerLifecycle(createServer(), exit);

    handlers.get('SIGTERM')!('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(console.error).toHaveBeenCalledWith(
      'Shutdown failed:',
      expect.any(Error),
    );
  });

  it('exits anyway when the cleanup hangs', async () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    mockShutdownTranscoding.mockImplementation(() => new Promise(() => {}));
    installServerLifecycle(createServer(), exit);

    handlers.get('SIGTERM')!('SIGTERM');
    await vi.advanceTimersByTimeAsync(8000);

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports a port conflict readably and exits', () => {
    const exit = vi.fn();
    const server = createServer();
    installServerLifecycle(server, exit);

    server.emit(
      'error',
      Object.assign(new Error('listen EADDRINUSE: address already in use'), {
        code: 'EADDRINUSE',
      }),
    );

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Set PORT to use another port'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('reports other server errors and exits', () => {
    const exit = vi.fn();
    const server = createServer();
    installServerLifecycle(server, exit);

    server.emit('error', new Error('EACCES'));

    expect(console.error).toHaveBeenCalledWith('Server error: EACCES');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('the returned function removes the signal handlers', () => {
    const dispose = installServerLifecycle(createServer(), vi.fn());
    expect(handlers.has('SIGTERM')).toBe(true);

    dispose();

    expect(handlers.has('SIGTERM')).toBe(false);
    expect(handlers.has('SIGINT')).toBe(false);
  });

  it('exits through process.exit by default', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    installServerLifecycle(createServer());

    handlers.get('SIGTERM')!('SIGTERM');

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });
});
