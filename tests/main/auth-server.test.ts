import { describe, it, expect, vi, afterEach } from 'vitest';
import { startAuthServer, stopAuthServer } from '../../src/main/auth-server';
import http from 'http';

// Mock http module
vi.mock('http', () => {
  const createServer = vi.fn();
  return {
    default: { createServer },
    createServer,
  };
});

describe('Auth Server', () => {
  let server: any;
  let requestHandler: any;

  afterEach(() => {
    stopAuthServer();
    vi.clearAllMocks();
  });

  it('starts the server on the specified port', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    const closeMock = vi.fn((cb) => cb && cb());
    const onMock = vi.fn();
    server = {
      listen: listenMock,
      close: closeMock,
      on: onMock,
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return server;
    });

    await startAuthServer(3000);

    expect(http.createServer).toHaveBeenCalled();
    expect(listenMock).toHaveBeenCalledWith(3000, expect.any(Function));
  });

  it('does not restart if already running', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    server = {
      listen: listenMock,
      close: vi.fn(),
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockReturnValue(server);

    await startAuthServer(3000);
    await startAuthServer(3000);

    expect(http.createServer).toHaveBeenCalledTimes(1);
  });

  it('handles /auth/google/callback route', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    server = {
      listen: listenMock,
      close: vi.fn(),
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return server;
    });

    await startAuthServer(3000);

    const req = {
      url: 'http://localhost:3000/auth/google/callback?code=123',
      headers: { host: 'localhost:3000' },
    };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': 'text/html' }),
    );
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('123'));
  });

  it('handles /auth/google/callback route without code', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    server = {
      listen: listenMock,
      close: vi.fn(),
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return server;
    });

    await startAuthServer(3000);

    const req = {
      url: 'http://localhost:3000/auth/google/callback',
      headers: { host: 'localhost:3000' },
    };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(400, {
      'Content-Type': 'text/plain',
    });
    expect(res.end).toHaveBeenCalledWith('Missing code parameter');
  });

  it('returns 404 for other routes', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    server = {
      listen: listenMock,
      close: vi.fn(),
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return server;
    });

    await startAuthServer(3000);

    const req = {
      url: 'http://localhost:3000/other',
      headers: { host: 'localhost:3000' },
    };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(404);
    expect(res.end).toHaveBeenCalled();
  });

  it('stops the server', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    const closeMock = vi.fn((cb) => cb && cb());
    server = {
      listen: listenMock,
      close: closeMock,
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockReturnValue(server);

    await startAuthServer(3000);
    await stopAuthServer();

    expect(closeMock).toHaveBeenCalled();
  });

  it('handles server error event', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    const closeMock = vi.fn((cb) => cb && cb());
    const onMock = vi.fn();
    server = {
      listen: listenMock,
      close: closeMock,
      on: onMock,
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockReturnValue(server);

    const startPromise = startAuthServer(3000);

    // Simulate error callback
    // We need to wait for startAuthServer to register the 'error' listener
    // But startAuthServer is awaiting listen... which we mock to call back immediately.
    // However, the error handler is registered BEFORE listen.
    // So we can find the call.

    const errorCall = onMock.mock.calls.find(
      (call: any[]) => call[0] === 'error',
    );
    if (errorCall) {
      const errorCallback = errorCall[1];
      errorCallback(new Error('EADDRINUSE'));
    }

    await startPromise;
    // Should resolve despite error
  });

  it('stopAuthServer handles null server', () => {
    stopAuthServer(); // Should not throw
  });

  it('escapes HTML in the code parameter', async () => {
    // This indirectly tests escapeHtml and getSuccessHtml
    const listenMock = vi.fn((_port, cb) => cb && cb());
    server = {
      listen: listenMock,
      close: vi.fn(),
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return server;
    });

    await startAuthServer(3000);

    const dangerousCode = '<script>alert("xss")</script>';
    const req = {
      url: `http://localhost:3000/auth/google/callback?code=${encodeURIComponent(dangerousCode)}`,
      headers: { host: 'localhost:3000' },
    };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;',
      ),
    );
    expect(res.end).toHaveBeenCalledWith(
      expect.stringContaining('Authentication Successful'),
    );
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining('Copied!')); // Check for some JS part
  });

  describe('OAuth state validation', () => {
    const mountServer = async (getExpectedState: () => string | null) => {
      const listenMock = vi.fn((_port, cb) => cb && cb());
      server = {
        listen: listenMock,
        close: vi.fn(),
        on: vi.fn(),
        address: () => ({ port: 3000 }),
      };
      (http.createServer as any).mockImplementation((handler: any) => {
        requestHandler = handler;
        return server;
      });
      await startAuthServer(3000, getExpectedState);
    };

    const makeRes = () => ({ writeHead: vi.fn(), end: vi.fn() });

    it('accepts a callback with the expected state', async () => {
      await mountServer(() => 'expected-state');
      const res = makeRes();
      requestHandler(
        {
          url: 'http://localhost:3000/auth/google/callback?code=123&state=expected-state',
          headers: { host: 'localhost:3000' },
        },
        res,
      );
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'Content-Type': 'text/html' }),
      );
    });

    it('rejects a callback with a mismatched state', async () => {
      await mountServer(() => 'expected-state');
      const res = makeRes();
      requestHandler(
        {
          url: 'http://localhost:3000/auth/google/callback?code=123&state=attacker-state',
          headers: { host: 'localhost:3000' },
        },
        res,
      );
      expect(res.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'text/plain',
      });
      expect(res.end).toHaveBeenCalledWith('Invalid state parameter');
    });

    it('rejects a callback with a missing state', async () => {
      await mountServer(() => 'expected-state');
      const res = makeRes();
      requestHandler(
        {
          url: 'http://localhost:3000/auth/google/callback?code=123',
          headers: { host: 'localhost:3000' },
        },
        res,
      );
      expect(res.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'text/plain',
      });
    });

    it('rejects a callback when no flow is pending', async () => {
      await mountServer(() => null);
      const res = makeRes();
      requestHandler(
        {
          url: 'http://localhost:3000/auth/google/callback?code=123&state=anything',
          headers: { host: 'localhost:3000' },
        },
        res,
      );
      expect(res.writeHead).toHaveBeenCalledWith(400, {
        'Content-Type': 'text/plain',
      });
    });
  });

  it('handles request with undefined url', async () => {
    const listenMock = vi.fn((_port, cb) => cb && cb());
    server = {
      listen: listenMock,
      close: vi.fn(),
      on: vi.fn(),
      address: () => ({ port: 3000 }),
    };
    (http.createServer as any).mockImplementation((handler: any) => {
      requestHandler = handler;
      return server;
    });

    await startAuthServer(3000);

    const req = {
      url: undefined,
      headers: { host: 'localhost:3000' },
    };
    const res = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };

    requestHandler(req, res);

    expect(res.writeHead).toHaveBeenCalledWith(404);
  });
});
